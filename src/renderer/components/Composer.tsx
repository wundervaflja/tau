import React, { useState, useRef, useEffect, useCallback } from "react";
import { bridge } from "../bridge";
import type { CommandInfo } from "../../shared/types";

// Web Speech API type declarations (not included in TS by default)
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}
interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}
interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}
interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: Event & { error: string }) => void) | null;
  onstart: (() => void) | null;
}
declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognition;
    webkitSpeechRecognition: new () => SpeechRecognition;
  }
}

interface ComposerProps {
  onSend: (text: string) => void;
  onAbort: () => void;
  onFileDrop?: (files: File[]) => void;
  isLoading: boolean;
  sessionVersion: number;
  /** Text to prefill the composer with (e.g. from /tree or /fork). Consumed once. */
  prefillText?: string | null;
  /** Called after prefillText is consumed. */
  onPrefillConsumed?: () => void;
}

export function Composer({
  onSend,
  onAbort,
  onFileDrop,
  isLoading,
  sessionVersion,
  prefillText,
  onPrefillConsumed,
}: ComposerProps) {
  const [text, setText] = useState("");
  const [commands, setCommands] = useState<CommandInfo[]>([]);
  const [filteredCommands, setFilteredCommands] = useState<CommandInfo[]>([]);
  const [showCommands, setShowCommands] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Per-session draft persistence
  const draftsRef = useRef<Map<number, string>>(new Map());
  const prevSessionRef = useRef<number>(sessionVersion);

  useEffect(() => {
    const prev = prevSessionRef.current;
    if (prev !== sessionVersion) {
      // Save current draft for the previous session
      draftsRef.current.set(prev, text);
      // Restore draft for the new session (or empty)
      const restored = draftsRef.current.get(sessionVersion) ?? "";
      setText(restored);
      prevSessionRef.current = sessionVersion;
    }
  }, [sessionVersion]); // intentionally omit `text` to avoid re-saving on every keystroke
  const menuRef = useRef<HTMLDivElement>(null);

  // File mention (@) autocomplete state
  const [fileMentionQuery, setFileMentionQuery] = useState("");
  const [fileMentionResults, setFileMentionResults] = useState<string[]>([]);
  const [showFileMention, setShowFileMention] = useState(false);
  const [fileMentionIndex, setFileMentionIndex] = useState(0);
  const fileMentionRef = useRef<HTMLDivElement>(null);
  const fileMentionDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Symbol mention (@file#symbol or @#symbol) autocomplete state
  interface SymbolResult { name: string; kind: string; file: string; line: number; }
  const [symbolResults, setSymbolResults] = useState<SymbolResult[]>([]);
  const [showSymbolMention, setShowSymbolMention] = useState(false);
  const [symbolMentionIndex, setSymbolMentionIndex] = useState(0);
  const symbolMentionRef = useRef<HTMLDivElement>(null);
  const symbolDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Voice input state
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState(""); // interim transcript
  const [speechSupported, setSpeechSupported] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  // Offline detection for voice
  const [isOnline, setIsOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const voiceErrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showVoiceError(msg: string) {
    setVoiceError(msg);
    if (voiceErrorTimer.current) clearTimeout(voiceErrorTimer.current);
    voiceErrorTimer.current = setTimeout(() => setVoiceError(null), 3500);
  }

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      if (voiceErrorTimer.current) clearTimeout(voiceErrorTimer.current);
    };
  }, []);

  // File attach / drop state
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);

  // Load commands
  const loadCommands = useCallback(async () => {
    try {
      const cmds = await bridge.listCommands();
      console.log("Loaded commands:", cmds.map((c) => c.name));
      setCommands(cmds);
    } catch (err) {
      console.error("Failed to load commands:", err);
    }
  }, []);

  // Load commands once and when session changes
  useEffect(() => {
    loadCommands();
  }, [loadCommands, sessionVersion]);

  // Check for Web Speech API support on mount
  useEffect(() => {
    const Rec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setSpeechSupported(!!Rec);
    return () => {
      // cleanup recognition if unmounted
      try {
        recognitionRef.current?.abort?.();
      } catch (_) {}
      recognitionRef.current = null;
    };
  }, []);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [text]);

  // Focus on mount and after sending or when loading toggles
  useEffect(() => {
    textareaRef.current?.focus();
  }, [isLoading]);

  // Consume prefill text (from /tree, /fork, etc.)
  useEffect(() => {
    if (prefillText != null && prefillText.length > 0) {
      setText(prefillText);
      onPrefillConsumed?.();
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [prefillText]);

  // Filter commands as user types
  useEffect(() => {
    if (text.startsWith("/") && !text.includes("\n")) {
      const query = text.slice(1).toLowerCase();
      // Don't show menu if there's a space (user is typing args)
      if (query.includes(" ")) {
        setShowCommands(false);
        return;
      }
      const filtered = commands.filter(
        (c) =>
          c.name.toLowerCase().includes(query) ||
          c.description.toLowerCase().includes(query)
      );
      setFilteredCommands(filtered);
      setShowCommands(filtered.length > 0);
      setSelectedIndex(0);
    } else {
      setShowCommands(false);
    }
  }, [text, commands]);

  // File/symbol mention (@) detection and search
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const cursorPos = textarea.selectionStart;
    const textBefore = text.slice(0, cursorPos);

    // Check for @file#symbol pattern first
    const symbolMatch = textBefore.match(/(?:^|\s)@([^\s#]*)#([^\s]*)$/);
    if (symbolMatch) {
      const filePart = symbolMatch[1];
      const symQuery = symbolMatch[2];
      setShowFileMention(false);
      setShowSymbolMention(true);
      setSymbolMentionIndex(0);

      if (symbolDebounce.current) clearTimeout(symbolDebounce.current);
      symbolDebounce.current = setTimeout(async () => {
        try {
          const results = await bridge.symbolsSearch(symQuery, filePart || undefined);
          setSymbolResults(results ?? []);
        } catch (err) {
          console.error("Failed to search symbols:", err);
          setSymbolResults([]);
        }
      }, 150);
      return () => { if (symbolDebounce.current) clearTimeout(symbolDebounce.current); };
    }

    setShowSymbolMention(false);
    setSymbolResults([]);

    // Check for @file pattern
    const mentionMatch = textBefore.match(/(?:^|\s)@([^\s]*)$/);
    if (mentionMatch) {
      const query = mentionMatch[1];
      setFileMentionQuery(query);
      setShowFileMention(true);
      setFileMentionIndex(0);

      if (fileMentionDebounce.current) clearTimeout(fileMentionDebounce.current);
      fileMentionDebounce.current = setTimeout(async () => {
        try {
          const results = await bridge.listFiles(query);
          setFileMentionResults(results);
        } catch (err) {
          console.error("Failed to list files:", err);
          setFileMentionResults([]);
        }
      }, 150);
    } else {
      setShowFileMention(false);
      setFileMentionResults([]);
    }

    return () => {
      if (fileMentionDebounce.current) clearTimeout(fileMentionDebounce.current);
      if (symbolDebounce.current) clearTimeout(symbolDebounce.current);
    };
  }, [text]);

  // Scroll selected item into view
  useEffect(() => {
    if (!showCommands || !menuRef.current) return;
    const item = menuRef.current.children[selectedIndex] as HTMLElement;
    if (item) {
      item.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex, showCommands]);

  // Scroll selected file mention into view
  useEffect(() => {
    if (!showFileMention || !fileMentionRef.current) return;
    const item = fileMentionRef.current.children[fileMentionIndex] as HTMLElement;
    if (item) {
      item.scrollIntoView({ block: "nearest" });
    }
  }, [fileMentionIndex, showFileMention]);

  // Scroll selected symbol mention into view
  useEffect(() => {
    if (!showSymbolMention || !symbolMentionRef.current) return;
    const items = symbolMentionRef.current.querySelectorAll("[data-symbol-item]");
    const item = items[symbolMentionIndex] as HTMLElement;
    if (item) item.scrollIntoView({ block: "nearest" });
  }, [symbolMentionIndex, showSymbolMention]);

  const selectCommand = useCallback((cmd: CommandInfo) => {
    setText("/" + cmd.name + " ");
    setShowCommands(false);
    textareaRef.current?.focus();
  }, []);

  const selectFileMention = useCallback((filePath: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const cursorPos = textarea.selectionStart;
    const textBefore = text.slice(0, cursorPos);
    const textAfter = text.slice(cursorPos);
    
    // Find the @ mention start position
    const mentionMatch = textBefore.match(/(?:^|\s)@([^\s]*)$/);
    if (!mentionMatch) return;
    
    const mentionStart = textBefore.lastIndexOf("@");
    const newText = text.slice(0, mentionStart) + "@" + filePath + " " + textAfter;
    setText(newText);
    setShowFileMention(false);
    setFileMentionResults([]);
    
    // Set cursor position after the inserted file path
    const newCursorPos = mentionStart + 1 + filePath.length + 1;
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    });
  }, [text]);

  const selectSymbolMention = useCallback((sym: SymbolResult) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const cursorPos = textarea.selectionStart;
    const textBefore = text.slice(0, cursorPos);
    const textAfter = text.slice(cursorPos);

    // Find the @...# mention start
    const mentionStart = textBefore.lastIndexOf("@");
    const ref = `@${sym.file}#${sym.name}`;
    const newText = text.slice(0, mentionStart) + ref + " " + textAfter;
    setText(newText);
    setShowSymbolMention(false);
    setSymbolResults([]);

    const newCursorPos = mentionStart + ref.length + 1;
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    });
  }, [text]);

  const clearAttachedFiles = useCallback(() => {
    setAttachedFiles([]);
  }, []);

  const appendTranscriptToText = useCallback((t: string) => {
    const clean = t.trim();
    if (!clean) return;
    setText((prev) => {
      const needsSpace = prev && !/\s$/.test(prev);
      return prev ? prev + (needsSpace ? " " : "") + clean : clean;
    });
  }, []);

  const startListening = useCallback(() => {
    if (!isOnline) {
      showVoiceError("Voice input requires internet. Connect to use speech-to-text.");
      return;
    }

    const RecClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!RecClass) return;

    try {
      const recognition: SpeechRecognition = new RecClass();
      recognitionRef.current = recognition;
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let interim = "";
        let finalParts: string[] = [];
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const alt = result[0];
          const frag = alt?.transcript || "";
          if (result.isFinal) {
            finalParts.push(frag);
          } else {
            interim += frag;
          }
        }
        // Update interim transcript shown in UI
        setTranscript(interim);

        // Append any final results to the textarea
        if (finalParts.length > 0) {
          const finalText = finalParts.join(" ").trim();
          if (finalText) {
            appendTranscriptToText(finalText);
            setTranscript("");
          }
        }
      };

      recognition.onend = () => {
        setIsListening(false);
        recognitionRef.current = null;
      };

      recognition.onerror = (e: any) => {
        const errorType = e?.error || "unknown";
        if (errorType === "no-speech") {
          // User didn't speak -- silently stop
        } else if (errorType === "network") {
          showVoiceError("Network error. Check your connection.");
        } else if (errorType === "not-allowed") {
          showVoiceError("Microphone access denied. Enable in System Settings.");
        } else {
          showVoiceError(`Voice input error: ${errorType}`);
        }
        console.error("Speech recognition error:", errorType);
        setIsListening(false);
        recognitionRef.current = null;
      };

      recognition.start();
      setIsListening(true);
      // focus textarea while listening
      textareaRef.current?.focus();
    } catch (err) {
      console.error("Failed to start speech recognition:", err);
      setIsListening(false);
    }
  }, [appendTranscriptToText]);

  const stopListening = useCallback(() => {
    try {
      recognitionRef.current?.stop();
    } catch (err) {
      // ignore
    }
    setIsListening(false);
    if (transcript && transcript.trim()) {
      appendTranscriptToText(transcript);
      setTranscript("");
    }
    recognitionRef.current = null;
    textareaRef.current?.focus();
  }, [transcript, appendTranscriptToText]);

  const handleSend = useCallback(async () => {
    if (!text.trim() && attachedFiles.length === 0) return;
    if (isLoading) return;

    let finalText = text.trim();

    // Resolve @file#symbol references to code snippets
    const symbolRefs = finalText.match(/@([^\s#]+)#(\w+)/g);
    if (symbolRefs && symbolRefs.length > 0) {
      const snippets: string[] = [];
      for (const ref of symbolRefs) {
        const match = ref.match(/@([^\s#]+)#(\w+)/);
        if (!match) continue;
        const [, file, symName] = match;
        try {
          const results = await bridge.symbolsSearch(symName, file);
          const sym = results?.find((r: SymbolResult) => r.name === symName && r.file === file);
          if (sym) {
            const data = await bridge.symbolRead(sym.file, sym.line);
            if (data?.snippet) {
              snippets.push(`\n\n--- ${ref} (${sym.file}:${sym.line}) ---\n\`\`\`\n${data.snippet}\n\`\`\``);
            }
          }
        } catch (err) {
          console.warn(`Failed to resolve ${ref}:`, err);
        }
      }
      if (snippets.length > 0) {
        finalText += snippets.join("");
      }
    }

    if (attachedFiles.length > 0) {
      const names = attachedFiles.map((f) => f.name).join(", ");
      finalText = `[Attached: ${names}] ` + (finalText ? finalText : "");
    }

    onSend(finalText);
    setText("");
    draftsRef.current.delete(sessionVersion);
    setShowCommands(false);
    setShowSymbolMention(false);
    clearAttachedFiles();
  }, [text, attachedFiles, isLoading, onSend, clearAttachedFiles]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Symbol mention navigation
      if (showSymbolMention && symbolResults.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSymbolMentionIndex((i) => i < symbolResults.length - 1 ? i + 1 : 0);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSymbolMentionIndex((i) => i > 0 ? i - 1 : symbolResults.length - 1);
          return;
        }
        if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
          e.preventDefault();
          selectSymbolMention(symbolResults[symbolMentionIndex]);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setShowSymbolMention(false);
          return;
        }
      }

      // File mention navigation
      if (showFileMention && fileMentionResults.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setFileMentionIndex((i) =>
            i < fileMentionResults.length - 1 ? i + 1 : 0
          );
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setFileMentionIndex((i) =>
            i > 0 ? i - 1 : fileMentionResults.length - 1
          );
          return;
        }
        if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
          e.preventDefault();
          selectFileMention(fileMentionResults[fileMentionIndex]);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setShowFileMention(false);
          return;
        }
      }

      // Command menu navigation
      if (showCommands && filteredCommands.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSelectedIndex((i) =>
            i < filteredCommands.length - 1 ? i + 1 : 0
          );
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSelectedIndex((i) =>
            i > 0 ? i - 1 : filteredCommands.length - 1
          );
          return;
        }
        if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
          // If the text is exactly a matching command (e.g. "/new"), send it on Enter
          const exactMatch = filteredCommands.find(
            (c) => "/" + c.name === text.trim()
          );
          if (e.key === "Enter" && exactMatch) {
            e.preventDefault();
            handleSend();
            return;
          }
          e.preventDefault();
          selectCommand(filteredCommands[selectedIndex]);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setShowCommands(false);
          return;
        }
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (isLoading) return;
        handleSend();
      }
      // Cmd+. to abort
      if (e.key === "." && e.metaKey && isLoading) {
        e.preventDefault();
        onAbort();
      }
    },
    [handleSend, isLoading, onAbort, showCommands, filteredCommands, selectedIndex, selectCommand, text, showFileMention, fileMentionResults, fileMentionIndex, selectFileMention, showSymbolMention, symbolResults, symbolMentionIndex, selectSymbolMention]
  );

  // File input change
  const onFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const list = e.target.files;
      if (!list || list.length === 0) return;
      const arr = Array.from(list);
      setAttachedFiles((prev) => [...prev, ...arr]);
      if (onFileDrop) onFileDrop(arr);
      // reset input so same file can be selected again if removed
      e.currentTarget.value = "";
    },
    [onFileDrop]
  );

  const triggerFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // Drag & drop handlers
  const onDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    const hasFiles = Array.from(e.dataTransfer?.types || []).includes("Files");
    if (hasFiles) setIsDragging(true);
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const hasFiles = Array.from(e.dataTransfer?.types || []).includes("Files");
    if (hasFiles) {
      e.dataTransfer.dropEffect = "copy";
      setIsDragging(true);
    }
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setIsDragging(false);
    }
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setIsDragging(false);
    const dt = e.dataTransfer;
    if (!dt) return;
    const files = Array.from(dt.files || []);
    if (files.length === 0) return;
    setAttachedFiles((prev) => [...prev, ...files]);
    if (onFileDrop) onFileDrop(files);
  }, [onFileDrop]);

  const removeAttachedFile = useCallback((index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  return (
    <div
      className="shrink-0 px-4 pb-4 pt-2"
      style={{ background: "var(--color-bg-surface)" }}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={onFileInputChange}
      />

      <div className="max-w-3xl mx-auto relative">
        {/* Slash command autocomplete menu */}
        {showCommands && (
          <div
            ref={menuRef}
            className="absolute bottom-full left-0 right-0 mb-2 rounded-xl overflow-hidden overflow-y-auto"
            style={{
              background: "var(--color-bg-elevated)",
              border: "1px solid var(--color-border)",
              boxShadow: "var(--shadow-lg, 0 10px 25px rgba(0,0,0,0.2))",
              maxHeight: "260px",
              zIndex: 100,
            }}
          >
            {filteredCommands.map((cmd, i) => (
              <button
                key={cmd.name}
                className="w-full text-left px-4 py-2.5 flex items-center gap-3 transition-colors"
                style={{
                  background:
                    i === selectedIndex ? "var(--color-bg-hover)" : "transparent",
                  color: "var(--color-text-primary)",
                }}
                onMouseEnter={() => setSelectedIndex(i)}
                onClick={() => {
                  // If it's a no-args command, just send it
                  const noArgCommands = [
                    "new",
                    "session",
                    "copy",
                    "share",
                    "hotkeys",
                    "changelog",
                    "login",
                    "logout",
                    "reload",
                    "quit",
                    "resume",
                    "settings",
                    "scoped-models",
                  ];
                  if (noArgCommands.includes(cmd.name)) {
                    setText("/" + cmd.name);
                    setTimeout(() => {
                      onSend("/" + cmd.name);
                      setText("");
                      setShowCommands(false);
                    }, 0);
                  } else {
                    selectCommand(cmd);
                  }
                }}
              >
                <span
                  className="font-mono text-sm font-medium shrink-0"
                  style={{ color: "var(--color-text-accent)" }}
                >
                  /{cmd.name}
                </span>
                <span className="text-sm truncate" style={{ color: "var(--color-text-secondary)" }}>
                  {cmd.description}
                </span>
                {cmd.source !== "builtin" && (
                  <span
                    className="text-xs px-1.5 py-0.5 rounded shrink-0"
                    style={{
                      background: "var(--color-bg-active)",
                      color: "var(--color-text-tertiary)",
                    }}
                  >
                    {cmd.source}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* File mention (@) autocomplete menu */}
        {showFileMention && fileMentionResults.length > 0 && (
          <div
            ref={fileMentionRef}
            className="absolute bottom-full left-0 right-0 mb-2 rounded-xl overflow-hidden overflow-y-auto"
            style={{
              background: "var(--color-bg-elevated)",
              border: "1px solid var(--color-border)",
              boxShadow: "var(--shadow-lg, 0 10px 25px rgba(0,0,0,0.2))",
              maxHeight: "260px",
              zIndex: 100,
            }}
          >
            <div
              className="px-3 py-1.5 text-xs font-medium"
              style={{ color: "var(--color-text-tertiary)", borderBottom: "1px solid var(--color-border)" }}
            >
              Files {fileMentionQuery && `matching "${fileMentionQuery}"`}
            </div>
            {fileMentionResults.map((filePath, i) => (
              <button
                key={filePath}
                className="w-full text-left px-4 py-2 flex items-center gap-3 transition-colors"
                style={{
                  background:
                    i === fileMentionIndex ? "var(--color-bg-hover)" : "transparent",
                  color: "var(--color-text-primary)",
                }}
                onMouseEnter={() => setFileMentionIndex(i)}
                onClick={() => selectFileMention(filePath)}
              >
                <span style={{ color: "var(--color-text-tertiary)", fontSize: "14px" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ display: "inline" }}>
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    <polyline points="14 2 14 8 20 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <span className="font-mono text-sm truncate" style={{ color: "var(--color-text-primary)" }}>
                  {filePath}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Symbol mention (@file#symbol) autocomplete menu */}
        {showSymbolMention && symbolResults.length > 0 && (
          <div
            ref={symbolMentionRef}
            className="absolute bottom-full left-0 right-0 mb-2 rounded-xl overflow-hidden overflow-y-auto"
            style={{
              background: "var(--color-bg-elevated)",
              border: "1px solid var(--color-border)",
              boxShadow: "var(--shadow-lg, 0 10px 25px rgba(0,0,0,0.2))",
              maxHeight: "300px",
              zIndex: 100,
            }}
          >
            <div
              className="px-3 py-1.5 text-xs font-medium"
              style={{ color: "var(--color-text-tertiary)", borderBottom: "1px solid var(--color-border)" }}
            >
              Symbols
            </div>
            {symbolResults.map((sym, i) => {
              const kindColors: Record<string, string> = {
                function: "#6366f1",
                class: "#f59e0b",
                interface: "#10b981",
                type: "#10b981",
                enum: "#8b5cf6",
                const: "#3b82f6",
                method: "#ec4899",
              };
              const kindIcons: Record<string, string> = {
                function: "ƒ",
                class: "C",
                interface: "I",
                type: "T",
                enum: "E",
                const: "c",
                method: "m",
              };
              return (
                <button
                  key={`${sym.file}:${sym.line}`}
                  data-symbol-item
                  className="w-full text-left px-4 py-2 flex items-center gap-3 transition-colors"
                  style={{
                    background: i === symbolMentionIndex ? "var(--color-bg-hover)" : "transparent",
                    color: "var(--color-text-primary)",
                  }}
                  onMouseEnter={() => setSymbolMentionIndex(i)}
                  onClick={() => selectSymbolMention(sym)}
                >
                  <span
                    className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-xs font-bold"
                    style={{
                      background: `${kindColors[sym.kind] ?? "#64748b"}22`,
                      color: kindColors[sym.kind] ?? "#64748b",
                    }}
                  >
                    {kindIcons[sym.kind] ?? "?"}
                  </span>
                  <span className="font-mono text-sm font-medium" style={{ color: "var(--color-text-primary)" }}>
                    {sym.name}
                  </span>
                  <span className="text-xs truncate" style={{ color: "var(--color-text-tertiary)" }}>
                    {sym.file}:{sym.line}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div
          className="relative flex flex-col rounded-2xl overflow-hidden transition-shadow"
          style={{
            background: "var(--color-bg-input)",
            border: isDragging
              ? "2px dashed var(--color-border-focus)"
              : "1px solid var(--color-border-heavy)",
            boxShadow: "var(--shadow-md)",
            padding: "8px",
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = "var(--color-border-focus)")}
          onBlur={(e) => (e.currentTarget.style.borderColor = "var(--color-border-heavy)")}
        >
          {/* Live transcript indicator (when listening and there's interim text) */}
          {isListening && transcript.trim() && (
            <div
              className="mb-2"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "6px 8px",
                borderRadius: "8px",
                background: "var(--color-bg-elevated)",
                border: "1px solid var(--color-border)",
                color: "var(--color-text-secondary)",
                fontSize: "12px",
              }}
            >
              <span style={{ color: "var(--color-text-accent)", fontWeight: 600 }}>Listening...</span>
              <span style={{ fontStyle: "italic", color: "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{transcript}</span>
            </div>
          )}

          {/* Top row: file attach button, mic button, textarea, send/stop */}
          <div className="flex items-end">
            {/* Left: attach button */}
            <div className="flex items-center pl-1 pr-2 pb-2">
              <button
                onClick={triggerFilePicker}
                className="p-2 rounded-xl transition-colors flex items-center justify-center"
                title="Attach files"
                style={{
                  background: "transparent",
                  color: "var(--color-text-tertiary)",
                }}
              >
                {/* Paperclip SVG */}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M21.44 11.05L12.12 20.37a5 5 0 0 1-7.07-7.07l8.66-8.66a3.5 3.5 0 0 1 4.95 4.95l-8.48 8.48a2 2 0 0 1-2.83-2.83l7.78-7.78" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>

            {/* Mic button (show only if supported) */}
            {speechSupported && (
              <div className="flex items-center pr-2 pb-2">
                <button
                  onClick={() => (isListening ? stopListening() : startListening())}
                  className="p-2 rounded-xl transition-all flex items-center justify-center"
                  title={!isOnline ? "Voice input requires internet" : "Voice input (click to start/stop)"}
                  style={{
                    background: "transparent",
                    color: isListening ? "var(--color-text-accent)" : "var(--color-text-tertiary)",
                    opacity: !isOnline && !isListening ? 0.4 : 1,
                    boxShadow: isListening ? "0 0 0 6px rgba(0,0,0,0.03)" : "none",
                    position: "relative",
                    animation: isListening ? "tau-mic-pulse 1.6s infinite" : undefined,
                  }}
                >
                  {/* Microphone SVG */}
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M19 11v1a7 7 0 0 1-14 0v-1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M12 19v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
            )}

            {/* Center: textarea */}
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isLoading ? "Agent is working…" : "Ask anything… (/ for commands)"}
              rows={1}
              className="flex-1 bg-transparent resize-none outline-none text-sm px-2 py-3 select-text"
              style={{
                color: "var(--color-text-primary)",
                fontFamily: "var(--font-sans)",
                maxHeight: "200px",
                caretColor: "var(--color-text-accent)",
                userSelect: "text",
                border: "none",
              }}
              disabled={false}
            />

            {/* Right: action button */}
            <div className="flex items-center pr-2 pb-2">
              {isLoading ? (
                <button
                  onClick={onAbort}
                  className="p-2 rounded-xl transition-colors flex items-center justify-center"
                  style={{
                    background: "var(--color-bg-active)",
                    color: "var(--color-text-secondary)",
                  }}
                  title="Stop (⌘.)"
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-text-error)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "var(--color-bg-active)")}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" />
                  </svg>
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={!text.trim() && attachedFiles.length === 0}
                  className="p-2 rounded-xl transition-all flex items-center justify-center"
                  style={{
                    background: text.trim() || attachedFiles.length > 0 ? "var(--color-bg-accent)" : "var(--color-bg-hover)",
                    color: text.trim() || attachedFiles.length > 0 ? "var(--color-text-on-accent)" : "var(--color-text-tertiary)",
                    opacity: text.trim() || attachedFiles.length > 0 ? 1 : 0.5,
                  }}
                  title="Send (Enter)"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M8 12V4M4 8l4-4 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* Drop overlay when dragging */}
          {isDragging && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                pointerEvents: "none",
              }}
            >
              <div
                style={{
                  padding: "8px 12px",
                  background: "rgba(255,255,255,0.02)",
                  color: "var(--color-text-accent)",
                  borderRadius: "8px",
                  border: "1px dashed var(--color-border-focus)",
                  fontSize: "12px",
                }}
              >
                Drop files here
              </div>
            </div>
          )}

          {/* Attached files chips */}
          {attachedFiles.length > 0 && (
            <div className="mt-2 px-1">
              <div className="flex gap-2 flex-wrap">
                {attachedFiles.map((f, i) => (
                  <div
                    key={`${f.name}-${i}`}
                    className="flex items-center gap-2 px-3 py-1 rounded-full"
                    style={{
                      background: "var(--color-bg-active)",
                      color: "var(--color-text-primary)",
                      fontSize: "12px",
                    }}
                  >
                    <span className="truncate" style={{ maxWidth: "200px" }} title={f.name}>
                      {f.name}
                    </span>
                    <button
                      onClick={() => removeAttachedFile(i)}
                      className="ml-1 p-1 rounded"
                      title="Remove"
                      style={{
                        background: "transparent",
                        color: "var(--color-text-tertiary)",
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                        <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Keyboard hint */}
          <div className="flex items-center justify-center gap-3 mt-2 text-xs" style={{ color: "var(--color-text-tertiary)" }}>
            {isLoading ? (
              <span>⌘. to stop</span>
            ) : (
              <>
                <span>↵ Send</span>
                <span>⇧↵ Newline</span>
                <span>/ Commands</span>
                <span>@ Files</span>
                <span>@file# Symbols</span>
              </>
            )}
          </div>

          {/* Mic pulse keyframes (scoped) */}
          <style>{`
            @keyframes tau-mic-pulse {
              0% { transform: scale(1); opacity: 1; }
              50% { transform: scale(1.06); opacity: 0.8; }
              100% { transform: scale(1); opacity: 1; }
            }
          `}</style>
        </div>

        {/* Voice error toast */}
        {voiceError && (
          <div
            className="mt-2 px-3 py-2 rounded-lg text-xs animate-fade-in"
            style={{
              background: "var(--color-bg-elevated)",
              border: "1px solid var(--color-border)",
              color: "var(--color-text-error)",
            }}
          >
            {voiceError}
          </div>
        )}
      </div>
    </div>
  );
}
