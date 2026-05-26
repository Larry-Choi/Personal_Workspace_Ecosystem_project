import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Clipboard,
  ClipboardPaste,
  ExternalLink,
  GripVertical,
  ListPlus,
  MonitorUp,
  Pin,
  PinOff,
  Play,
  Plus,
  Search,
  Save,
  Shuffle,
  Trash2,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";

type Track = {
  id: string;
  title: string;
  videoId: string;
};

type SavedPlaylist = {
  id: string;
  name: string;
  tracks: Track[];
};

type SearchResult = {
  title: string;
  videoId: string;
  channelTitle: string;
};

type YouTubePlayer = {
  destroy: () => void;
  playVideo: () => void;
};

type YouTubePlayerConstructor = new (
  element: HTMLElement,
  options: {
    videoId: string;
    playerVars: Record<string, string | number>;
    events: {
      onReady: (event: { target: YouTubePlayer }) => void;
      onStateChange: (event: { data: number }) => void;
    };
  },
) => YouTubePlayer;

declare global {
  interface Window {
    YT?: {
      Player: YouTubePlayerConstructor;
      PlayerState: {
        ENDED: number;
      };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

const LEGACY_STORAGE_KEY = "underdesk-music-playlist";
const PLAYLISTS_KEY = "underdesk-music-playlists";
const ACTIVE_PLAYLIST_KEY = "underdesk-music-active-playlist";
const ALWAYS_ON_TOP_KEY = "underdesk-music-always-on-top";
const MINI_MODE_KEY = "underdesk-music-mini-mode";
const YOUTUBE_API_KEY = "underdesk-music-youtube-api-key";
const appWindow = getCurrentWindow();

const DEFAULT_TRACKS: Track[] = [
  {
    id: crypto.randomUUID(),
    title: "lofi hip hop radio",
    videoId: "jfKfPfyJRdk",
  },
  {
    id: crypto.randomUUID(),
    title: "jazz cafe ambience",
    videoId: "Dx5qFachd3A",
  },
];

function getYoutubeVideoId(input: string) {
  const trimmed = input.trim();

  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    if (url.hostname.includes("youtu.be")) {
      return url.pathname.split("/").filter(Boolean)[0] ?? "";
    }

    if (url.searchParams.has("v")) {
      return url.searchParams.get("v") ?? "";
    }

    const embedMatch = url.pathname.match(/\/(?:embed|shorts|live)\/([a-zA-Z0-9_-]{11})/);
    return embedMatch?.[1] ?? "";
  } catch {
    return "";
  }
}

function getYoutubeVideoIds(input: string) {
  const candidates = input
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  const ids = candidates.map(getYoutubeVideoId).filter((videoId) => videoId.length === 11);
  return [...new Set(ids)];
}

function normalizePlaylist(value: unknown): Track[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const track = item as Partial<Track>;
      if (typeof track.videoId !== "string" || !/^[a-zA-Z0-9_-]{11}$/.test(track.videoId)) {
        return null;
      }

      return {
        id: typeof track.id === "string" ? track.id : crypto.randomUUID(),
        title:
          typeof track.title === "string" && track.title.trim()
            ? track.title
            : `YouTube ${track.videoId}`,
        videoId: track.videoId,
      };
    })
    .filter((track): track is Track => Boolean(track));
}

function normalizeSavedPlaylists(value: unknown): SavedPlaylist[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const saved = item as Partial<SavedPlaylist>;
      const tracks = normalizePlaylist(saved.tracks);

      return {
        id: typeof saved.id === "string" ? saved.id : crypto.randomUUID(),
        name:
          typeof saved.name === "string" && saved.name.trim()
            ? saved.name
            : `Playlist ${index + 1}`,
        tracks,
      };
    })
    .filter((playlist): playlist is SavedPlaylist => Boolean(playlist));
}

function loadSavedPlaylists() {
  const raw = localStorage.getItem(PLAYLISTS_KEY);
  if (raw) {
    try {
      const parsed = normalizeSavedPlaylists(JSON.parse(raw));
      if (parsed.length) return parsed;
    } catch {
      // Fall through to legacy migration.
    }
  }

  const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (legacy) {
    try {
      const tracks = normalizePlaylist(JSON.parse(legacy));
      if (tracks.length) {
        return [{ id: crypto.randomUUID(), name: "Main", tracks }];
      }
    } catch {
      // Use default playlist below.
    }
  }

  return [{ id: crypto.randomUUID(), name: "Main", tracks: DEFAULT_TRACKS }];
}

function encodeShareCode(playlist: SavedPlaylist) {
  const payload = JSON.stringify({
    v: 2,
    name: playlist.name,
    tracks: playlist.tracks.map(({ title, videoId }) => ({ title, videoId })),
  });
  return btoa(unescape(encodeURIComponent(payload)));
}

function decodeShareCode(code: string) {
  const parsed = JSON.parse(decodeURIComponent(escape(atob(code.trim())))) as {
    name?: unknown;
    tracks?: unknown;
    p?: unknown;
    playlist?: unknown;
  };
  return {
    name: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name : "Imported",
    tracks: normalizePlaylist(parsed.tracks ?? parsed.p ?? parsed.playlist ?? parsed),
  };
}

function decodeHtmlTitle(value: string) {
  const parser = new DOMParser();
  return parser.parseFromString(value, "text/html").documentElement.textContent ?? value;
}

function loadYouTubeApi() {
  if (window.YT?.Player) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    const previousReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previousReady?.();
      resolve();
    };

    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      document.body.appendChild(script);
    }
  });
}

function App() {
  const [initialState] = useState(() => {
    const playlists = loadSavedPlaylists();
    const savedId = localStorage.getItem(ACTIVE_PLAYLIST_KEY);
    return {
      playlists,
      activePlaylistId: playlists.some((playlist) => playlist.id === savedId)
        ? savedId!
        : playlists[0].id,
    };
  });
  const [savedPlaylists, setSavedPlaylists] = useState<SavedPlaylist[]>(
    initialState.playlists,
  );
  const [activePlaylistId, setActivePlaylistId] = useState(initialState.activePlaylistId);
  const [activeId, setActiveId] = useState("");
  const [url, setUrl] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [youtubeApiKey, setYoutubeApiKey] = useState(
    () => localStorage.getItem(YOUTUBE_API_KEY) ?? "",
  );
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [shareCode, setShareCode] = useState("");
  const [alwaysOnTop, setAlwaysOnTop] = useState(
    () => localStorage.getItem(ALWAYS_ON_TOP_KEY) === "true",
  );
  const [miniMode, setMiniMode] = useState(
    () => localStorage.getItem(MINI_MODE_KEY) === "true",
  );
  const [status, setStatus] = useState("Saved");
  const playerHostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const playlistRef = useRef<Track[]>([]);
  const activeIdRef = useRef(activeId);

  const activeSavedPlaylist =
    savedPlaylists.find((playlist) => playlist.id === activePlaylistId) ?? savedPlaylists[0];
  const playlist = activeSavedPlaylist?.tracks ?? [];
  const activeTrack = playlist.find((track) => track.id === activeId) ?? playlist[0];
  const pendingVideoIds = useMemo(() => getYoutubeVideoIds(url), [url]);
  const canAdd = pendingVideoIds.length > 0;

  useEffect(() => {
    if (!playlist.some((track) => track.id === activeId)) {
      setActiveId(playlist[0]?.id ?? "");
    }
  }, [playlist, activeId]);

  useEffect(() => {
    playlistRef.current = playlist;
  }, [playlist]);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(savedPlaylists));
    localStorage.setItem(ACTIVE_PLAYLIST_KEY, activePlaylistId);
    setStatus("Saved");
  }, [savedPlaylists, activePlaylistId]);

  useEffect(() => {
    appWindow.setAlwaysOnTop(alwaysOnTop).catch(() => undefined);
    localStorage.setItem(ALWAYS_ON_TOP_KEY, String(alwaysOnTop));
  }, [alwaysOnTop]);

  useEffect(() => {
    const size = miniMode ? new LogicalSize(360, 390) : new LogicalSize(760, 760);
    appWindow.setSize(size).catch(() => undefined);
    appWindow.setResizable(!miniMode).catch(() => undefined);
    localStorage.setItem(MINI_MODE_KEY, String(miniMode));
  }, [miniMode]);

  useEffect(() => {
    localStorage.setItem(YOUTUBE_API_KEY, youtubeApiKey.trim());
  }, [youtubeApiKey]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    appWindow
      .onResized(async () => {
        if (disposed) return;
        const minimized = await appWindow.isMinimized().catch(() => false);
        if (minimized) {
          await appWindow.hide().catch(() => undefined);
        }
      })
      .then((listener) => {
        unlisten = listener;
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const updateActivePlaylist = useCallback(
    (updater: (playlist: SavedPlaylist) => SavedPlaylist) => {
      setSavedPlaylists((current) =>
        current.map((playlistItem) =>
          playlistItem.id === activePlaylistId ? updater(playlistItem) : playlistItem,
        ),
      );
    },
    [activePlaylistId],
  );

  const setPlaylistTracks = useCallback(
    (updater: Track[] | ((tracks: Track[]) => Track[])) => {
      updateActivePlaylist((playlistItem) => {
        const nextTracks =
          typeof updater === "function" ? updater(playlistItem.tracks) : updater;
        return { ...playlistItem, tracks: nextTracks };
      });
    },
    [updateActivePlaylist],
  );

  const playNextTrack = useCallback(() => {
    const current = playlistRef.current;
    if (!current.length) return;

    const activeIndex = current.findIndex((track) => track.id === activeIdRef.current);
    const nextIndex = activeIndex >= 0 ? (activeIndex + 1) % current.length : 0;
    setActiveId(current[nextIndex].id);
  }, []);

  useEffect(() => {
    const host = playerHostRef.current;
    if (!host || !activeTrack) return;

    let cancelled = false;

    loadYouTubeApi().then(() => {
      if (cancelled || !window.YT?.Player || !playerHostRef.current) return;

      playerRef.current?.destroy();
      const mount = document.createElement("div");
      playerHostRef.current.replaceChildren(mount);

      playerRef.current = new window.YT.Player(mount, {
        videoId: activeTrack.videoId,
        playerVars: {
          autoplay: 1,
          playsinline: 1,
          rel: 0,
          enablejsapi: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: (event) => event.target.playVideo(),
          onStateChange: (event) => {
            if (event.data === window.YT?.PlayerState.ENDED) {
              playNextTrack();
            }
          },
        },
      });
    });

    return () => {
      cancelled = true;
    };
  }, [activeTrack, playNextTrack]);

  function addTrack(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pendingVideoIds.length) return;

    const nextTracks = pendingVideoIds.map((videoId, index) => ({
      id: crypto.randomUUID(),
      title: `YouTube ${videoId}${pendingVideoIds.length > 1 ? ` #${index + 1}` : ""}`,
      videoId,
    }));

    setPlaylistTracks((current) => [...current, ...nextTracks]);
    setActiveId(nextTracks[0].id);
    setUrl("");
    setStatus(nextTracks.length === 1 ? "Added" : `Added ${nextTracks.length}`);
  }

  function addSearchResult(result: SearchResult) {
    const nextTrack = {
      id: crypto.randomUUID(),
      title: result.title,
      videoId: result.videoId,
    };

    setPlaylistTracks((current) => [...current, nextTrack]);
    setActiveId(nextTrack.id);
    setStatus("Added");
  }

  function removeTrack(id: string) {
    setPlaylistTracks((current) => {
      const next = current.filter((track) => track.id !== id);
      if (activeIdRef.current === id) setActiveId(next[0]?.id ?? "");
      return next;
    });
  }

  function renameTrack(id: string, title: string) {
    setPlaylistTracks((current) =>
      current.map((track) => (track.id === id ? { ...track, title } : track)),
    );
  }

  function moveTrack(id: string, direction: -1 | 1) {
    setPlaylistTracks((current) => {
      const index = current.findIndex((track) => track.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;

      const next = [...current];
      const [track] = next.splice(index, 1);
      next.splice(target, 0, track);
      return next;
    });
  }

  async function searchOnYouTube() {
    const query = searchQuery.trim() || url.trim();
    if (!query) return;
    if (!youtubeApiKey.trim()) {
      setStatus("API key needed");
      return;
    }

    setIsSearching(true);
    setStatus("Searching");

    try {
      const params = new URLSearchParams({
        part: "snippet",
        type: "video",
        maxResults: "8",
        q: query,
        key: youtubeApiKey.trim(),
      });
      const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
      if (!response.ok) throw new Error("Search failed");

      const data = (await response.json()) as {
        items?: Array<{
          id?: { videoId?: string };
          snippet?: { title?: string; channelTitle?: string };
        }>;
      };
      const results =
        data.items
          ?.map((item) => ({
            videoId: item.id?.videoId ?? "",
            title: decodeHtmlTitle(item.snippet?.title ?? "Untitled"),
            channelTitle: decodeHtmlTitle(item.snippet?.channelTitle ?? "YouTube"),
          }))
          .filter((item) => item.videoId.length === 11) ?? [];

      setSearchResults(results);
      setStatus(results.length ? `Found ${results.length}` : "No results");
    } catch {
      setStatus("Search failed");
    } finally {
      setIsSearching(false);
    }
  }

  async function exportCode() {
    if (!activeSavedPlaylist) return;
    const code = encodeShareCode(activeSavedPlaylist);
    setShareCode(code);
    await navigator.clipboard?.writeText(code).catch(() => undefined);
    setStatus("Code copied");
  }

  function importCode() {
    try {
      const imported = decodeShareCode(shareCode);
      if (!imported.tracks.length) {
        setStatus("Code import failed");
        return;
      }

      const nextPlaylist = {
        id: crypto.randomUUID(),
        name: imported.name,
        tracks: imported.tracks,
      };
      setSavedPlaylists((current) => [...current, nextPlaylist]);
      setActivePlaylistId(nextPlaylist.id);
      setActiveId(nextPlaylist.tracks[0].id);
      setStatus("Code imported");
    } catch {
      setStatus("Code import failed");
    }
  }

  function shufflePlaylist() {
    setPlaylistTracks((current) => {
      const next = [...current];
      for (let index = next.length - 1; index > 0; index -= 1) {
        const target = Math.floor(Math.random() * (index + 1));
        [next[index], next[target]] = [next[target], next[index]];
      }
      return next;
    });
    setStatus("Shuffled");
  }

  function addPlaylist() {
    const nextPlaylist = {
      id: crypto.randomUUID(),
      name: `Playlist ${savedPlaylists.length + 1}`,
      tracks: [],
    };
    setSavedPlaylists((current) => [...current, nextPlaylist]);
    setActivePlaylistId(nextPlaylist.id);
    setActiveId("");
    setStatus("Playlist added");
  }

  function deletePlaylist() {
    if (savedPlaylists.length <= 1) {
      setStatus("Keep one playlist");
      return;
    }

    setSavedPlaylists((current) => {
      const next = current.filter((playlistItem) => playlistItem.id !== activePlaylistId);
      setActivePlaylistId(next[0].id);
      setActiveId(next[0].tracks[0]?.id ?? "");
      return next;
    });
    setStatus("Playlist deleted");
  }

  function renamePlaylist(name: string) {
    updateActivePlaylist((playlistItem) => ({ ...playlistItem, name }));
  }

  return (
    <main className={miniMode ? "app mini" : "app"}>
      <header className="topbar">
        <div>
          <p className="eyebrow">Underdesk</p>
          <h1>Music</h1>
        </div>
        <div className="window-actions">
          <button
            className={alwaysOnTop ? "icon-button active" : "icon-button"}
            type="button"
            onClick={() => setAlwaysOnTop((value) => !value)}
            title={alwaysOnTop ? "Disable always on top" : "Always on top"}
            aria-label={alwaysOnTop ? "Disable always on top" : "Always on top"}
          >
            {alwaysOnTop ? <PinOff size={18} /> : <Pin size={18} />}
          </button>
          <button
            className={miniMode ? "icon-button active" : "icon-button"}
            type="button"
            onClick={() => setMiniMode((value) => !value)}
            title={miniMode ? "Normal mode" : "Mini mode"}
            aria-label={miniMode ? "Normal mode" : "Mini mode"}
          >
            <MonitorUp size={18} />
          </button>
        </div>
      </header>

      {!miniMode && (
        <section className="playlist-manager">
          <select
            value={activePlaylistId}
            onChange={(event) => setActivePlaylistId(event.target.value)}
            aria-label="Saved playlists"
          >
            {savedPlaylists.map((playlistItem) => (
              <option key={playlistItem.id} value={playlistItem.id}>
                {playlistItem.name}
              </option>
            ))}
          </select>
          <input
            value={activeSavedPlaylist?.name ?? ""}
            onChange={(event) => renamePlaylist(event.target.value)}
            placeholder="Playlist name"
            aria-label="Playlist name"
          />
          <button type="button" onClick={addPlaylist} title="New playlist">
            <Plus size={16} />
          </button>
          <button
            type="button"
            onClick={deletePlaylist}
            disabled={savedPlaylists.length <= 1}
            title="Delete playlist"
          >
            <Trash2 size={16} />
          </button>
        </section>
      )}

      <div className="content-grid">
        <section className="player" aria-label="YouTube player">
          {activeTrack ? (
            <div className="youtube-host" ref={playerHostRef} />
          ) : (
            <div className="empty-player">
              <ListPlus size={30} />
            </div>
          )}
        </section>

        {!miniMode && (
          <aside className="search-panel" aria-label="Search results">
            <div className="search-panel-header">
              <span>Search</span>
              <button
                type="button"
                onClick={() =>
                  openUrl(
                    `https://www.youtube.com/results?search_query=${encodeURIComponent(searchQuery)}`,
                  )
                }
                disabled={!searchQuery.trim()}
                title="Open YouTube"
              >
                <ExternalLink size={14} />
              </button>
            </div>
            <input
              className="api-key-input"
              value={youtubeApiKey}
              onChange={(event) => setYoutubeApiKey(event.target.value)}
              placeholder="YouTube Data API key"
              aria-label="YouTube Data API key"
            />
            <div className="result-list">
              {searchResults.map((result) => (
                <button
                  key={result.videoId}
                  className="result-item"
                  type="button"
                  onClick={() => addSearchResult(result)}
                  title={`${result.title} - ${result.channelTitle}`}
                >
                  <span>{result.title}</span>
                  <small>{result.channelTitle}</small>
                </button>
              ))}
              {!searchResults.length && (
                <div className="empty-results">{isSearching ? "Searching" : "No results"}</div>
              )}
            </div>
          </aside>
        )}
      </div>

      <section className="now-playing">
        <div>
          <span>Now Playing</span>
          <strong title={activeTrack?.title}>{activeTrack?.title ?? "Playlist is empty"}</strong>
        </div>
        {activeTrack && (
          <button
            className="icon-button"
            type="button"
            onClick={() => openUrl(`https://www.youtube.com/watch?v=${activeTrack.videoId}`)}
            title="Open on YouTube"
            aria-label="Open on YouTube"
          >
            <ExternalLink size={17} />
          </button>
        )}
      </section>

      {!miniMode && (
        <section className="entry-panel">
          <form className="add-form" onSubmit={addTrack}>
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="YouTube URL, video ID, or multiple URLs"
              aria-label="YouTube URL, video ID, or multiple URLs"
            />
            <button type="submit" disabled={!canAdd} title="Add track">
              <Plus size={17} />
              Add
            </button>
          </form>
          <div className="search-row">
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search YouTube"
              aria-label="Search YouTube"
            />
            <button
              type="button"
              onClick={searchOnYouTube}
              disabled={!searchQuery.trim() && !url.trim()}
              title="Search YouTube"
            >
              <Search size={16} />
              Search
            </button>
          </div>
          <div className="code-row">
            <textarea
              value={shareCode}
              onChange={(event) => setShareCode(event.target.value)}
              placeholder="Playlist code"
              aria-label="Playlist code"
            />
            <div className="code-actions">
              <button type="button" onClick={exportCode} disabled={!playlist.length}>
                Export
              </button>
              <button type="button" onClick={importCode} disabled={!shareCode.trim()}>
                Import
              </button>
            </div>
          </div>
        </section>
      )}

      <section className="playlist" aria-label="Playlist">
        <div className="section-title">
          <span>Playlist</span>
          <div className="playlist-tools">
            <button
              type="button"
              onClick={exportCode}
              disabled={!playlist.length}
              title="Export code"
              aria-label="Export code"
            >
              <Clipboard size={14} />
            </button>
            <button
              type="button"
              onClick={importCode}
              disabled={!shareCode.trim()}
              title="Import code"
              aria-label="Import code"
            >
              <ClipboardPaste size={14} />
            </button>
            <button
              type="button"
              onClick={shufflePlaylist}
              disabled={playlist.length < 2}
              title="Shuffle playlist"
              aria-label="Shuffle playlist"
            >
              <Shuffle size={14} />
            </button>
            <small title={status}>
              <Save size={13} />
              {status}
            </small>
          </div>
        </div>
        <div className="track-list">
          {playlist.map((track, index) => (
            <article
              className={track.id === activeTrack?.id ? "track active" : "track"}
              key={track.id}
            >
              <button
                className="play-button"
                type="button"
                onClick={() => setActiveId(track.id)}
                title="Play"
                aria-label="Play"
              >
                {track.id === activeTrack?.id ? <GripVertical size={17} /> : <Play size={16} />}
              </button>
              <div className="track-title">
                <input
                  value={track.title}
                  onChange={(event) => renameTrack(track.id, event.target.value)}
                  onFocus={() => setActiveId(track.id)}
                  title={track.title}
                  aria-label="Track title"
                />
                <small>{track.videoId}</small>
              </div>
              {!miniMode && (
                <div className="track-actions">
                  <button
                    type="button"
                    onClick={() => moveTrack(track.id, -1)}
                    disabled={index === 0}
                    title="Move up"
                    aria-label="Move up"
                  >
                    <ArrowUp size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveTrack(track.id, 1)}
                    disabled={index === playlist.length - 1}
                    title="Move down"
                    aria-label="Move down"
                  >
                    <ArrowDown size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeTrack(track.id)}
                    title="Delete"
                    aria-label="Delete"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

export default App;
