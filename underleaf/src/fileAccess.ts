import type { UnderleafDocument } from "./types";

type FileSystemFileHandle = {
  getFile: () => Promise<File>;
  createWritable: () => Promise<{
    write: (data: Blob | string) => Promise<void>;
    close: () => Promise<void>;
  }>;
};

type FilePickerAccept = {
  description: string;
  accept: Record<string, string[]>;
};

type FilePickerWindow = Window &
  typeof globalThis & {
    showOpenFilePicker?: (options: {
      multiple?: boolean;
      types?: FilePickerAccept[];
    }) => Promise<FileSystemFileHandle[]>;
    showSaveFilePicker?: (options: {
      suggestedName?: string;
      types?: FilePickerAccept[];
    }) => Promise<FileSystemFileHandle>;
  };

export const underleafFileType: FilePickerAccept = {
  description: "Underleaf Document",
  accept: {
    "application/json": [".underleaf.json", ".json"]
  }
};

export const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

export const downloadText = (content: string, filename: string, type: string) => {
  downloadBlob(new Blob([content], { type }), filename);
};

export const saveWithPicker = async (
  blob: Blob,
  suggestedName: string,
  types: FilePickerAccept[]
) => {
  const pickerWindow = window as FilePickerWindow;
  if (!pickerWindow.showSaveFilePicker) {
    downloadBlob(blob, suggestedName);
    return "downloaded";
  }

  const handle = await pickerWindow.showSaveFilePicker({
    suggestedName,
    types
  });
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
  return "saved";
};

export const pickUnderleafDocument = async () => {
  const pickerWindow = window as FilePickerWindow;

  if (pickerWindow.showOpenFilePicker) {
    const [handle] = await pickerWindow.showOpenFilePicker({
      multiple: false,
      types: [underleafFileType]
    });
    const file = await handle.getFile();
    return JSON.parse(await file.text()) as UnderleafDocument;
  }

  return new Promise<UnderleafDocument>((resolve, reject) => {
    const input = window.document.createElement("input");
    input.type = "file";
    input.accept = ".underleaf.json,.json,application/json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        reject(new Error("No file selected."));
        return;
      }
      try {
        resolve(JSON.parse(await file.text()) as UnderleafDocument);
      } catch (error) {
        reject(error);
      }
    };
    input.click();
  });
};

export const validateUnderleafDocument = (value: unknown): value is UnderleafDocument => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<UnderleafDocument>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.version === "number" &&
    Array.isArray(candidate.blocks)
  );
};
