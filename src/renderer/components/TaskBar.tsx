import React, { useMemo, useState, useRef } from "react";

type Intent = "chat" | "command" | "voice";

function detectIntent(text: string, isRecording: boolean): Intent {
  if (isRecording) return "voice";
  const trimmed = text.trim().toLowerCase();
  if (trimmed.startsWith("/")) return "command";
  return "chat";
}

interface TaskBarProps {
  onSend: (text: string) => void;
  isLoading: boolean;
}

export function TaskBar({ onSend, isLoading }: TaskBarProps) {
  const [text, setText] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = useRef<any>(null);
  const voiceAvailable =
    !!(window as any).SpeechRecognition || !!(window as any).webkitSpeechRecognition;

  const intent = useMemo(() => detectIntent(text, isRecording), [text, isRecording]);

  function handleSubmit() {
    if (!text.trim() || isLoading) return;
    onSend(text.trim());
    setText("");
  }

  function toggleVoice() {
    const Speech = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Speech) return;
    if (isRecording) {
      recognitionRef.current?.stop();
      setIsRecording(false);
      return;
    }
    const rec = new Speech();
    recognitionRef.current = rec;
    rec.continuous = false;
    rec.interimResults = true;
    rec.onresult = (e: any) => {
      const transcript = Array.from(e.results)
        .map((r: any) => r[0].transcript)
        .join("");
      setText(transcript);
    };
    rec.onend = () => {
      setIsRecording(false);
    };
    setIsRecording(true);
    rec.start();
  }

  const intentLabel =
    intent === "command"
      ? "Command"
      : intent === "voice"
      ? "Voice"
      : "Chat";

  return (
    <div
      className="px-4 py-3"
      style={{
        borderBottom: "1px solid var(--color-border)",
        background: "var(--color-bg-surface)",
      }}
    >
      <div className="max-w-3xl mx-auto flex items-center gap-2">
        <div
          className="px-2 py-1 rounded-md text-xs font-medium"
          style={{
            background: "var(--color-bg-hover)",
            color: "var(--color-text-secondary)",
          }}
        >
          {intentLabel}
        </div>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"Ask a question or run a command…"}
          className="flex-1 text-sm rounded-md px-3 py-2 outline-none"
          style={{
            background: "var(--color-bg-input)",
            color: "var(--color-text-primary)",
            border: "1px solid var(--color-border)",
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
        />
        <button
          onClick={toggleVoice}
          disabled={!voiceAvailable}
          className="p-2 rounded-md transition-colors"
          style={{
            background: isRecording ? "var(--color-bg-accent)" : "var(--color-bg-hover)",
            color: isRecording ? "var(--color-text-on-accent)" : "var(--color-text-tertiary)",
            opacity: voiceAvailable ? 1 : 0.5,
          }}
          title={isRecording ? "Stop recording" : "Voice input"}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path
              d="M8 10a2 2 0 0 0 2-2V4a2 2 0 0 0-4 0v4a2 2 0 0 0 2 2Zm4-2a4 4 0 0 1-8 0H3a5 5 0 0 0 10 0h-1ZM8 13v2"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          onClick={handleSubmit}
          className="px-3 py-2 rounded-md text-sm font-medium transition-colors"
          style={{
            background: "var(--color-bg-accent)",
            color: "var(--color-text-on-accent)",
            opacity: text.trim() ? 1 : 0.6,
          }}
          disabled={!text.trim() || isLoading}
        >
          Go
        </button>
      </div>
    </div>
  );
}
