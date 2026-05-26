import { invoke } from "@tauri-apps/api/core";
import {
  AppWindow,
  Boxes,
  Chrome,
  Code2,
  Compass,
  Disc3,
  Folder,
  Gamepad2,
  Github,
  Music2,
  NotebookText,
  Play,
  Plus,
  RefreshCcw,
  Search,
  Server,
  Settings,
  Terminal,
  Timer,
  Trash2,
  Users,
  X
} from "lucide-react";
import { PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type LaunchKind = "url" | "file" | "folder" | "scheme" | "command" | "exe";
type IconName =
  | "code"
  | "terminal"
  | "music"
  | "notes"
  | "game"
  | "server"
  | "chrome"
  | "discord"
  | "folder"
  | "settings"
  | "github"
  | "timer"
  | "zotero";

type Star = {
  id: string;
  key?: string;
  label: string;
  groupId: string;
  x: number;
  y: number;
  icon: IconName;
  iconData?: string;
  accent: string;
  kind: LaunchKind;
  target: string;
};

type Group = {
  id: string;
  name: string;
  color: string;
  memberIds: string[];
  x?: number;
  y?: number;
};

type Toast = {
  id: number;
  title: string;
  body: string;
  color: string;
};

type RunningApp = {
  name: string;
  path: string;
  title: string;
  iconData?: string;
};

const world = {
  width: 3200,
  height: 2200
};

const initialGroups: Group[] = [];

const initialStars: Star[] = [];

const iconMap = {
  code: Code2,
  terminal: Terminal,
  music: Music2,
  notes: NotebookText,
  game: Gamepad2,
  server: Server,
  chrome: Chrome,
  discord: Users,
  folder: Folder,
  settings: Settings,
  github: Github,
  timer: Timer,
  zotero: Boxes
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const storageKey = "asterism.workspace.v2";
const slotKeys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];

function loadWorkspace() {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return { stars: initialStars, groups: initialGroups };
    const parsed = JSON.parse(raw) as { stars?: Star[]; groups?: Group[] };
    if (!Array.isArray(parsed.stars) || !Array.isArray(parsed.groups)) {
      return { stars: initialStars, groups: initialGroups };
    }
    return { stars: parsed.stars, groups: parsed.groups };
  } catch {
    return { stars: initialStars, groups: initialGroups };
  }
}

function groupCenter(group: Group, stars: Star[]) {
  const members = group.memberIds
    .map((id) => stars.find((star) => star.id === id))
    .filter((star): star is Star => Boolean(star));

  if (!members.length) return { x: group.x ?? world.width / 2, y: group.y ?? world.height / 2 };
  return {
    x: members.reduce((sum, star) => sum + star.x, 0) / members.length,
    y: members.reduce((sum, star) => sum + star.y, 0) / members.length
  };
}

export function App() {
  const initialWorkspace = useMemo(loadWorkspace, []);
  const [stars, setStars] = useState(initialWorkspace.stars);
  const [groups, setGroups] = useState(initialWorkspace.groups);
  const [activeId, setActiveId] = useState(initialWorkspace.stars[0]?.id ?? "");
  const [activeGroupId, setActiveGroupId] = useState(
    initialWorkspace.stars[0]?.groupId ?? initialWorkspace.groups[0]?.id ?? ""
  );
  const [camera, setCamera] = useState({ x: world.width / 2, y: world.height / 2, scale: 0.72 });
  const [groupMode, setGroupMode] = useState(false);
  const [appPickerOpen, setAppPickerOpen] = useState(false);
  const [runningApps, setRunningApps] = useState<RunningApp[]>([]);
  const [appQuery, setAppQuery] = useState("");
  const [loadingApps, setLoadingApps] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef({ active: false, x: 0, y: 0, cameraX: 0, cameraY: 0, moved: false });
  const starDragRef = useRef({ active: false, id: "", x: 0, y: 0, starX: 0, starY: 0, moved: false });
  const pointerRef = useRef({ x: 0, y: 0, inside: false });

  const activeStar = stars.find((star) => star.id === activeId);
  const activeGroup =
    groups.find((group) => group.id === activeGroupId) ??
    groups.find((group) => group.id === activeStar?.groupId) ??
    groups[0];
  const activeGroupStars = useMemo(
    () =>
      (activeGroup?.memberIds ?? [])
        .map((id) => stars.find((star) => star.id === id))
        .filter((star): star is Star => Boolean(star)),
    [activeGroup?.memberIds, stars]
  );
  const visibleRunningApps = useMemo(() => {
    const query = appQuery.trim().toLowerCase();
    if (!query) return runningApps.slice(0, 18);
    return runningApps
      .filter((app) => `${app.name} ${app.title} ${app.path}`.toLowerCase().includes(query))
      .slice(0, 18);
  }, [appQuery, runningApps]);

  const slotForGroup = useCallback((id: string) => {
    const index = groups.findIndex((group) => group.id === id);
    return index >= 0 && index < slotKeys.length ? slotKeys[index] : undefined;
  }, [groups]);

  const focusStar = useCallback((star: Star, scale = 1.05) => {
    setActiveId(star.id);
    setActiveGroupId(star.groupId);
    setCamera({ x: star.x, y: star.y, scale });
  }, []);

  const focusGroup = useCallback((group: Group, scale = 0.92) => {
    const center = groupCenter(group, stars);
    setActiveGroupId(group.id);
    setActiveId("");
    setCamera({ x: center.x, y: center.y, scale });
  }, [stars]);

  const pushToast = useCallback((title: string, body: string, color: string) => {
    const id = Date.now() + Math.random();
    setToasts((items) => [{ id, title, body, color }, ...items].slice(0, 4));
    window.setTimeout(() => {
      setToasts((items) => items.filter((item) => item.id !== id));
    }, 4200);
  }, []);

  const loadRunningApps = useCallback(async () => {
    setLoadingApps(true);
    try {
      const apps = await invoke<RunningApp[]>("list_running_apps");
      setRunningApps(apps);
      if (!apps.length) pushToast("No running apps found", "Try opening an app with a visible window.", "#ffd166");
    } catch (error) {
      pushToast("Could not read running apps", String(error), "#ff7a9c");
    } finally {
      setLoadingApps(false);
    }
  }, [pushToast]);

  const launchStar = useCallback(
    async (star: Star) => {
      try {
        await invoke("launch_target", { target: star.target, kind: star.kind });
        pushToast(`Launched ${star.label}`, star.target, star.accent);
      } catch (error) {
        pushToast(`Could not launch ${star.label}`, String(error), "#ff7a9c");
      }
    },
    [pushToast]
  );

  const launchGroup = useCallback(async () => {
    if (!activeGroup) return;
    const members = activeGroup.memberIds
      .map((id) => stars.find((star) => star.id === id))
      .filter((star): star is Star => Boolean(star));

    for (const [index, star] of members.entries()) {
      window.setTimeout(() => void launchStar(star), index * 140);
    }
  }, [activeGroup, launchStar, stars]);

  const launchSpecificGroup = useCallback(
    async (group: Group) => {
      const members = group.memberIds
        .map((id) => stars.find((star) => star.id === id))
        .filter((star): star is Star => Boolean(star));

      for (const [index, star] of members.entries()) {
        window.setTimeout(() => void launchStar(star), index * 140);
      }
    },
    [launchStar, stars]
  );

  const moveByDirection = useCallback(
    (dx: number, dy: number) => {
      if (!activeStar) return;
      const current = activeStar;
      let best = current;
      let bestScore = Number.POSITIVE_INFINITY;

      for (const star of stars) {
        if (star.id === current.id) continue;
        const vx = star.x - current.x;
        const vy = star.y - current.y;
        const dot = vx * dx + vy * dy;
        if (dot <= 0) continue;

        const distance = Math.hypot(vx, vy);
        const alignmentPenalty = 1 - dot / distance;
        const score = distance + alignmentPenalty * 720;
        if (score < bestScore) {
          best = star;
          bestScore = score;
        }
      }

      if (best.id !== current.id) focusStar(best);
    },
    [activeStar, focusStar, stars]
  );

  const createGroup = () => {
    const trimmed = draftName.trim();
    if (!trimmed) {
      pushToast("Name the group first", "Create a group, then add running apps into it.", "#ffd166");
      return;
    }

    const id = `group-${Date.now()}`;
    const colors = ["#70d7ff", "#91ffb9", "#ffd166", "#b89cff", "#ff7a9c"];
    const color = colors[groups.length % colors.length];
    const angle = groups.length * 2.25;
    const center = {
      x: clamp(world.width / 2 + Math.cos(angle) * 520, 240, world.width - 240),
      y: clamp(world.height / 2 + Math.sin(angle) * 520, 220, world.height - 220)
    };
    setGroups((items) => [...items, { id, name: trimmed, color, memberIds: [], x: center.x, y: center.y }]);
    setActiveGroupId(id);
    setActiveId("");
    setCamera({ x: center.x, y: center.y, scale: 0.92 });
    setDraftName("");
    setGroupMode(false);
    setAppPickerOpen(true);
    pushToast("Group created", trimmed, color);
  };

  const addExecutableApp = async (app: RunningApp) => {
    if (!activeGroup) {
      pushToast("Create a group first", "Apps need a group before they can become stars.", "#ffd166");
      setGroupMode(true);
      return;
    }
    let iconData = app.iconData;
    if (!iconData) {
      try {
        iconData = await invoke<string>("extract_executable_icon", { path: app.path });
      } catch {
        iconData = undefined;
      }
    }

    const center = groupCenter(activeGroup, stars);
    const index = activeGroup.memberIds.length;
    const angle = index * 1.85;
    const radius = 170 + (index % 4) * 38;
    const id = `app-${Date.now()}-${Math.round(Math.random() * 1000)}`;
    const star: Star = {
      id,
      label: app.name,
      groupId: activeGroup.id,
      x: clamp(center.x + Math.cos(angle) * radius, 80, world.width - 80),
      y: clamp(center.y + Math.sin(angle) * radius, 80, world.height - 80),
      icon: "folder",
      iconData,
      accent: activeGroup.color,
      kind: "exe",
      target: app.path
    };

    setStars((items) => [...items, star]);
    setGroups((items) =>
      items.map((group) =>
        group.id === activeGroup.id ? { ...group, memberIds: [...group.memberIds, id] } : group
      )
    );
    setActiveId(id);
    setActiveGroupId(activeGroup.id);
    setCamera({ x: star.x, y: star.y, scale: 1.05 });
    setAppPickerOpen(false);
    pushToast("App added", `${app.name} joined ${activeGroup.name}`, activeGroup.color);
  };

  const chooseExecutable = useCallback(async () => {
    if (!activeGroup) {
      pushToast("Create a group first", "Apps need a group before they can become stars.", "#ffd166");
      setGroupMode(true);
      return;
    }

    setLoadingApps(true);
    try {
      const app = await invoke<RunningApp | null>("pick_executable");
      if (app) await addExecutableApp(app);
    } catch (error) {
      pushToast("Could not choose executable", String(error), "#ff7a9c");
    } finally {
      setLoadingApps(false);
    }
  }, [activeGroup, addExecutableApp, pushToast]);

  const removeStar = (id: string) => {
    const star = stars.find((item) => item.id === id);
    if (!star) return;
    setStars((items) => items.filter((item) => item.id !== id));
    setGroups((items) =>
      items.map((group) => ({ ...group, memberIds: group.memberIds.filter((memberId) => memberId !== id) }))
    );
    setActiveId("");
    pushToast("Removed app", star.label, "#ff7a9c");
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button, input")) return;
    dragRef.current = {
      active: true,
      x: event.clientX,
      y: event.clientY,
      cameraX: camera.x,
      cameraY: camera.y,
      moved: false
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    pointerRef.current = { x: event.clientX, y: event.clientY, inside: true };
    const starDrag = starDragRef.current;
    if (starDrag.active) {
      const dx = (event.clientX - starDrag.x) / camera.scale;
      const dy = (event.clientY - starDrag.y) / camera.scale;
      if (Math.hypot(dx, dy) > 3) starDrag.moved = true;
      setStars((items) =>
        items.map((star) =>
          star.id === starDrag.id
            ? {
                ...star,
                x: clamp(starDrag.starX + dx, 40, world.width - 40),
                y: clamp(starDrag.starY + dy, 40, world.height - 40)
              }
            : star
        )
      );
      return;
    }

    const drag = dragRef.current;
    if (!drag.active) return;

    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.hypot(dx, dy) > 3) drag.moved = true;
    setCamera((value) => ({
      ...value,
      x: clamp(drag.cameraX - dx / value.scale, 0, world.width),
      y: clamp(drag.cameraY - dy / value.scale, 0, world.height)
    }));
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    dragRef.current.active = false;
    starDragRef.current.active = false;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // The pointer may have been captured by a star instead of the viewport.
    }
  };

  const onStarPointerDown = (event: PointerEvent<HTMLButtonElement>, star: Star) => {
    if ((event.target as HTMLElement).closest(".remove-star")) return;
    event.stopPropagation();
    starDragRef.current = {
      active: true,
      id: star.id,
      x: event.clientX,
      y: event.clientY,
      starX: star.x,
      starY: star.y,
      moved: false
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).tagName === "INPUT") return;

      const slotIndex = event.key === "0" ? 9 : Number(event.key) - 1;
      const keyGroup = Number.isInteger(slotIndex) ? groups[slotIndex] : undefined;
      if (keyGroup) {
        event.preventDefault();
        focusGroup(keyGroup);
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "enter") {
        event.preventDefault();
        if (event.shiftKey || !activeStar) void launchGroup();
        else if (activeStar) void launchStar(activeStar);
      } else if (key === "escape") {
        setCamera({ x: world.width / 2, y: world.height / 2, scale: 0.62 });
      } else if (key === "arrowup" || key === "w") {
        moveByDirection(0, -1);
      } else if (key === "arrowdown" || key === "s") {
        moveByDirection(0, 1);
      } else if (key === "arrowleft" || key === "a") {
        moveByDirection(-1, 0);
      } else if (key === "arrowright" || key === "d") {
        moveByDirection(1, 0);
      } else if (key === "g") {
        setGroupMode((value) => !value);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeStar, focusGroup, groups, launchGroup, launchStar, moveByDirection]);

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify({ stars, groups }));
  }, [groups, stars]);

  useEffect(() => {
    if (appPickerOpen && !runningApps.length) void loadRunningApps();
  }, [appPickerOpen, loadRunningApps, runningApps.length]);

  useEffect(() => {
    let rafId = 0;
    const tick = () => {
      const viewport = viewportRef.current;
      const pointer = pointerRef.current;
      if (viewport && pointer.inside && !dragRef.current.active && !starDragRef.current.active) {
        const rect = viewport.getBoundingClientRect();
        const edge = 72;
        let dx = 0;
        let dy = 0;

        if (pointer.x - rect.left < edge) dx = -1 + (pointer.x - rect.left) / edge;
        if (rect.right - pointer.x < edge) dx = 1 - (rect.right - pointer.x) / edge;
        if (pointer.y - rect.top < edge) dy = -1 + (pointer.y - rect.top) / edge;
        if (rect.bottom - pointer.y < edge) dy = 1 - (rect.bottom - pointer.y) / edge;

        if (dx || dy) {
          setCamera((value) => ({
            ...value,
            x: clamp(value.x + dx * 18 / value.scale, 0, world.width),
            y: clamp(value.y + dy * 18 / value.scale, 0, world.height)
          }));
        }
      }

      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, []);

  const viewport = viewportRef.current?.getBoundingClientRect();
  const viewportWidth = viewport?.width ?? window.innerWidth;
  const viewportHeight = viewport?.height ?? window.innerHeight;
  const translateX = viewportWidth / 2 - camera.x * camera.scale;
  const translateY = viewportHeight / 2 - camera.y * camera.scale;
  const activeMemberIds = new Set(activeGroup?.memberIds ?? []);

  return (
    <main
      className="app"
      ref={viewportRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerLeave={() => {
        pointerRef.current.inside = false;
      }}
      onPointerUp={onPointerUp}
    >
      <div className="starfield" />
      <div
        className="world"
        style={{
          width: world.width,
          height: world.height,
          transform: `translate3d(${translateX}px, ${translateY}px, 0) scale(${camera.scale})`
        }}
      >
        <svg className="constellations" viewBox={`0 0 ${world.width} ${world.height}`}>
          {groups.flatMap((group) =>
            group.memberIds.slice(0, -1).map((id, index) => {
              const from = stars.find((star) => star.id === id);
              const to = stars.find((star) => star.id === group.memberIds[index + 1]);
              if (!from || !to) return null;
              const active = group.id === activeGroup?.id;
              return (
                <line
                  key={`${group.id}-${id}`}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  className={active ? "line-active" : ""}
                  style={{ "--group-color": group.color } as React.CSSProperties}
                />
              );
            })
          )}
        </svg>

        {groups.map((group) => {
          const members = group.memberIds
            .map((id) => stars.find((star) => star.id === id))
            .filter((star): star is Star => Boolean(star));
          const center = groupCenter(group, stars);
          const slot = slotForGroup(group.id);

          return (
            <button
              type="button"
              key={group.id}
              className={`group-label ${group.id === activeGroup?.id ? "active" : ""} ${members.length ? "" : "empty"}`}
              style={{ left: center.x, top: center.y, "--group-color": group.color } as React.CSSProperties}
              onClick={() => focusGroup(group)}
              onDoubleClick={() => {
                focusGroup(group);
                void launchSpecificGroup(group);
              }}
            >
              {slot ? <span>{slot}</span> : null}
              {group.name}
            </button>
          );
        })}

        {stars.map((star) => {
          const Icon = iconMap[star.icon];
          const active = star.id === activeId;
          const inActiveGroup = activeMemberIds.has(star.id);

          return (
            <button
              className={`star ${active ? "active" : ""} ${inActiveGroup ? "in-group" : ""}`}
              key={star.id}
              type="button"
              style={{ left: star.x, top: star.y, "--accent": star.accent } as React.CSSProperties}
              onPointerDown={(event) => onStarPointerDown(event, star)}
              onPointerUp={(event) => {
                starDragRef.current.active = false;
                try {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                } catch {
                  // Pointer capture is best-effort here.
                }
              }}
              onClick={() => {
                if (starDragRef.current.moved) return;
                focusStar(star);
              }}
              onDoubleClick={() => void launchStar(star)}
            >
              <span className="star-orb">
                {star.iconData ? (
                  <img src={star.iconData} alt="" draggable={false} />
                ) : (
                  <Icon size={19} strokeWidth={2.35} />
                )}
              </span>
              <span className="star-name">{star.label}</span>
              {active ? (
                <span
                  className="remove-star"
                  role="button"
                  tabIndex={0}
                  onClick={(event) => {
                    event.stopPropagation();
                    removeStar(star.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      event.stopPropagation();
                      removeStar(star.id);
                    }
                  }}
                >
                  <Trash2 size={13} /> Remove
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <header className="hud topbar">
        <div>
          <p>Asterism</p>
          <h1>{activeStar?.label ?? activeGroup?.name ?? "Create a group"}</h1>
        </div>
        <div className="active-meta">
          <Compass size={17} />
          <span>{activeGroup ? `${activeGroup.name} slots` : "No group"}</span>
        </div>
      </header>

      <aside className="hud inspector">
        {activeGroup ? (
          <>
            <div className="inspector-title">
              <span className="mini-dot" style={{ background: activeStar?.accent ?? activeGroup.color }} />
              <div>
                <strong>{activeStar?.label ?? activeGroup.name}</strong>
                <small>{activeStar?.target ?? "Add running apps to this group."}</small>
              </div>
            </div>
            <div className="group-roster">
              {activeGroupStars.length ? (
                activeGroupStars.map((star) => (
                  <button type="button" key={star.id} onClick={() => focusStar(star)}>
                    <span />
                    <strong>{star.label}</strong>
                    <small
                      role="button"
                      tabIndex={0}
                      onClick={(event) => {
                        event.stopPropagation();
                        removeStar(star.id);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          event.stopPropagation();
                          removeStar(star.id);
                        }
                      }}
                    >
                      Remove
                    </small>
                  </button>
                ))
              ) : (
                <p className="empty-copy">No apps yet.</p>
              )}
            </div>
            <div className="actions">
              <button type="button" disabled={!activeStar} onClick={() => activeStar && void launchStar(activeStar)}>
                <Play size={16} /> Launch
              </button>
              <button type="button" disabled={!activeGroupStars.length} onClick={() => void launchGroup()}>
                <Disc3 size={16} /> Launch group
              </button>
              <button type="button" onClick={() => setAppPickerOpen(true)}>
                <AppWindow size={16} /> Add app
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="inspector-title">
              <span className="mini-dot" />
              <div>
                <strong>No groups yet</strong>
                <small>Create a group first, then add apps into it.</small>
              </div>
            </div>
            <div className="actions single">
              <button type="button" onClick={() => setGroupMode(true)}>
                <Plus size={16} /> Create group
              </button>
            </div>
          </>
        )}
      </aside>

      <section className={`hud group-editor ${groupMode ? "open" : ""}`}>
        <div className="panel-head">
          <strong>Group stars</strong>
          <button type="button" className="icon-button" onClick={() => setGroupMode(false)}>
            <X size={16} />
          </button>
        </div>
        <input
          value={draftName}
          onChange={(event) => setDraftName(event.target.value)}
          placeholder="Group name"
        />
        <div className="group-list">
          {groups.length ? (
            groups.map((group) => (
              <button
                type="button"
                key={group.id}
                className={group.id === activeGroup?.id ? "selected" : ""}
                onClick={() => {
                  focusGroup(group, group.memberIds.length ? 0.94 : 0.72);
                }}
              >
                <span className="mini-dot" style={{ background: group.color }} />
                <strong>{group.name}</strong>
                <small>{slotForGroup(group.id) ?? group.memberIds.length}</small>
              </button>
            ))
          ) : (
            <small>Create your first group.</small>
          )}
        </div>
        <button type="button" onClick={createGroup}>
          <Plus size={16} /> Create group
        </button>
      </section>

      <button type="button" className={`group-toggle ${groupMode ? "on" : ""}`} onClick={() => setGroupMode((value) => !value)}>
        <Plus size={17} />
        Group
      </button>

      <section className={`hud app-picker ${appPickerOpen ? "open" : ""}`}>
        <div className="panel-head">
          <strong>Add running app</strong>
          <button type="button" className="icon-button" onClick={() => setAppPickerOpen(false)}>
            <X size={16} />
          </button>
        </div>
        <button type="button" className="choose-exe" onClick={() => void chooseExecutable()}>
          <Folder size={16} /> Choose EXE
        </button>
        <div className="search-box">
          <Search size={15} />
          <input
            value={appQuery}
            onChange={(event) => setAppQuery(event.target.value)}
            placeholder="Search open windows"
          />
          <button type="button" className="icon-button" onClick={() => void loadRunningApps()}>
            <RefreshCcw size={15} />
          </button>
        </div>
        <div className="app-list">
          {loadingApps ? <small>Reading running apps...</small> : null}
          {!loadingApps && !visibleRunningApps.length ? <small>No matching apps.</small> : null}
          {visibleRunningApps.map((app) => (
            <button type="button" key={`${app.name}-${app.path}`} onClick={() => void addExecutableApp(app)}>
              {app.iconData ? <img src={app.iconData} alt="" draggable={false} /> : <span className="mini-dot" />}
              <span>
                <strong>{app.name}</strong>
                <small>{app.title || app.path}</small>
              </span>
            </button>
          ))}
        </div>
      </section>

      <nav className="shortcut-bar">
        <span>1-0 groups</span>
        <span>WASD move</span>
        <span>drag pan</span>
        <span>edge pan</span>
        <span>Enter launch selected/group</span>
        <span>Shift Enter group</span>
        <span>G group</span>
      </nav>

      <section className="toast-stack">
        {toasts.map((toast) => (
          <article key={toast.id} style={{ "--accent": toast.color } as React.CSSProperties}>
            <strong>{toast.title}</strong>
            <span>{toast.body}</span>
          </article>
        ))}
      </section>
    </main>
  );
}
