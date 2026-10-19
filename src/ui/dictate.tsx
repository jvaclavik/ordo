import { Mic } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useUi } from "./state.tsx";
import { cx, IconButton } from "./ui.tsx";

type Alternative = { transcript: string };
type RecognitionResult = { isFinal: boolean; 0?: Alternative };
type RecognitionEvent = { results: ArrayLike<RecognitionResult> };
type RecognitionError = { error: string };
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionError) => void) | null;
  onend: (() => void) | null;
};

function recognitionCtor(): (new () => Recognition) | null {
  const host = window as Window & {
    SpeechRecognition?: new () => Recognition;
    webkitSpeechRecognition?: new () => Recognition;
  };
  return host.SpeechRecognition ?? host.webkitSpeechRecognition ?? null;
}

export function mergeSpoken(base: string, spoken: string): string {
  const extra = spoken.replace(/\s+/g, " ").trim();
  if (!extra) return base;
  const trimmed = base.replace(/\s+$/, "");
  if (!trimmed) return extra;
  return `${trimmed} ${extra}`;
}

function spokenText(results: ArrayLike<RecognitionResult>): string {
  const parts: string[] = [];
  for (let index = 0; index < results.length; index += 1) {
    const transcript = results[index]?.[0]?.transcript ?? "";
    if (transcript.trim()) parts.push(transcript);
  }
  return parts.join(" ");
}

function failureText(error: string): string | null {
  if (error === "aborted") return null;
  if (error === "not-allowed" || error === "service-not-allowed")
    return "Povol mikrofon, ať jde úkol namluvit.";
  if (error === "audio-capture") return "Mikrofon se nepodařilo zapnout.";
  if (error === "no-speech") return "Nic jsem neslyšel.";
  return "Diktování se nepodařilo. Zkontroluj mikrofon a připojení.";
}

export function DictateButton({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const ui = useUi();
  const [listening, setListening] = useState(false);
  const session = useRef<Recognition | null>(null);
  const base = useRef(value);
  const valueRef = useRef(value);
  valueRef.current = value;

  const stop = () => {
    session.current?.stop();
    session.current = null;
    setListening(false);
  };

  useEffect(
    () => () => {
      session.current?.abort();
      session.current = null;
    },
    []
  );

  const toggle = () => {
    if (session.current) {
      stop();
      return;
    }
    const Ctor = recognitionCtor();
    if (!Ctor) {
      ui.pushToast("Diktování tenhle prohlížeč neumí.");
      return;
    }
    const recognition = new Ctor();
    recognition.lang = "cs-CZ";
    recognition.interimResults = true;
    recognition.continuous = true;
    base.current = valueRef.current;
    recognition.onresult = (event) => {
      onChange(mergeSpoken(base.current, spokenText(event.results)));
    };
    recognition.onerror = (event) => {
      const text = failureText(event.error);
      if (text) ui.pushToast(text);
    };
    recognition.onend = () => {
      session.current = null;
      setListening(false);
    };
    try {
      recognition.start();
    } catch {
      ui.pushToast("Diktování se nepodařilo. Zkontroluj mikrofon a připojení.");
      return;
    }
    session.current = recognition;
    setListening(true);
  };

  return (
    <IconButton
      label={listening ? "Zastavit diktování" : "Namluvit úkol"}
      aria-pressed={listening}
      data-dictate=""
      className={cx(listening && "bg-danger/15 text-danger")}
      onMouseDown={(event) => event.preventDefault()}
      onClick={toggle}
    >
      <Mic size={16} />
    </IconButton>
  );
}
