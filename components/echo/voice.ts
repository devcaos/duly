"use client";

// Voice in (Web Speech API) and voice out (Amazon Polly via /api/speak, browser voice as fallback).

// The parts of the Web Speech API we use. TypeScript's DOM types don't include it yet.
interface RecognitionResultEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type RecognitionConstructor = new () => Recognition;

export interface ListenHandlers {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (message: string) => void;
  onEnd: () => void;
}

export const BRAVE_MESSAGE = "Voice input doesn't work in Brave. Use Chrome or Edge, or type your question.";

// Starts listening once (en-US). Returns a function that stops listening.
export function startListening(handlers: ListenHandlers): () => void {
  const speechWindow = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
    navigator: { brave?: { isBrave(): Promise<boolean> } };
  };
  const Ctor = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
  if (!Ctor) {
    handlers.onError("Voice input needs Chrome or Edge. Please type instead.");
    handlers.onEnd();
    return () => {};
  }

  // Brave has webkitSpeechRecognition but blocks Google's speech service, so recognition
  // ends at once with no result. Only Brave has navigator.brave: every other browser
  // starts right away, exactly as before.
  const brave = speechWindow.navigator.brave;
  if (brave) {
    let cancelled = false;
    let stop: () => void = () => {
      cancelled = true;
      handlers.onEnd();
    };
    brave
      .isBrave()
      .catch(() => false)
      .then((isBrave) => {
        if (cancelled) return;
        if (isBrave) {
          stop = () => {};
          handlers.onError(BRAVE_MESSAGE);
          handlers.onEnd();
        } else {
          stop = listen(Ctor, handlers);
        }
      });
    return () => stop();
  }
  return listen(Ctor, handlers);
}

function listen(Ctor: RecognitionConstructor, handlers: ListenHandlers): () => void {
  const recognition = new Ctor();
  recognition.lang = "en-US";
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;

  let finalText = "";
  recognition.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) finalText += result[0].transcript;
      else interim += result[0].transcript;
    }
    handlers.onInterim((finalText + interim).trim());
  };
  recognition.onerror = (event) => {
    // "no-speech" and "aborted" just mean nothing was said.
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      handlers.onError("Microphone access is blocked. Allow it in the browser, or type instead.");
    } else if (event.error !== "no-speech" && event.error !== "aborted") {
      handlers.onError("I couldn't hear that. Please try again or type instead.");
    }
  };
  recognition.onend = () => {
    if (finalText.trim()) handlers.onFinal(finalText.trim());
    handlers.onEnd();
  };
  recognition.start();
  return () => recognition.stop();
}

let currentAudio: HTMLAudioElement | null = null;
let currentUrl: string | null = null;
// Ends the pending speak() promise when its audio is stopped early.
let finishAudio: (() => void) | null = null;

// Stops whatever is being said right now.
export function stopSpeaking() {
  finishAudio?.();
  finishAudio = null;
  currentAudio?.pause();
  currentAudio = null;
  if (currentUrl) URL.revokeObjectURL(currentUrl);
  currentUrl = null;
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}

// Speaks the text with Polly; if that fails, with the browser's own voice.
// Resolves when speaking ends (or fails), so the page can turn the light bar off.
export async function speak(text: string): Promise<void> {
  stopSpeaking();
  try {
    const response = await fetch("/api/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) throw new Error(`speak returned ${response.status}`);
    const url = URL.createObjectURL(await response.blob());
    const audio = new Audio(url);
    currentAudio = audio;
    currentUrl = url;
    await new Promise<void>((resolve, reject) => {
      finishAudio = resolve;
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error("audio playback failed"));
      audio.play().catch(reject);
    });
    if (currentAudio === audio) stopSpeaking();
  } catch {
    await speakWithBrowser(text);
  }
}

function speakWithBrowser(text: string): Promise<void> {
  if (!("speechSynthesis" in window)) return Promise.resolve();
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    const voices = window.speechSynthesis.getVoices().filter((voice) => voice.lang === "en-US");
    utterance.voice =
      voices.find((voice) => /Google US English|Samantha|Aria|Jenny/.test(voice.name)) ?? voices[0] ?? null;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    window.speechSynthesis.speak(utterance);
  });
}
