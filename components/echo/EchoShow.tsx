"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { MAX_HISTORY_TURNS } from "@/lib/agent/types";
import type { Card, ChatResponse, ChatTurn } from "@/lib/agent/types";
import {
  DeadlineRow,
  DeadlinesCard,
  DocumentCard,
  DraftCard,
  ExplanationCard,
  MatchesCard,
  WarrantyCard,
} from "./cards";
import type { DeadlineItem, DraftData } from "./cards";
import { useClock, useFitScale, useSpeechSupported } from "./hooks";
import { speak, startListening, stopSpeaking } from "./voice";
import styles from "./echo.module.css";

// The Echo Show simulator (SPEC.md section 7): voice or typed questions go to /api/chat,
// which answers with Bedrock + Duly's MCP tools; replies are spoken and shown as cards.

// Size of everything on the page at 100% (device 1180x700 plus banner and controls).
const STAGE_WIDTH = 1180;
const STAGE_HEIGHT = 980;
const SCREEN_EXIT_MS = 260;
const HOME_DEADLINES = 4;
// 3 MB, the add_document limit (SPEC.md section 4).
const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
const UPLOAD_TYPES = ["image/jpeg", "image/png", "application/pdf"];

const SUGGESTIONS = [
  "What do I need to pay this month?",
  "Is my dishwasher still under warranty?",
  "What does the parking notice mean? What happens if I ignore it?",
  "Write a reply asking for a payment extension on the electricity bill.",
  "When does the car insurance renew?",
];

type Mode = "idle" | "listening" | "thinking" | "speaking";

type Screen =
  | { id: number; kind: "home" }
  | { id: number; kind: "answer"; query: string; reply: string; cards: Card[]; tools: string[]; error?: boolean };

type HomeDeadlines = { status: "loading" } | { status: "ready"; items: DeadlineItem[] } | { status: "error" };

let nextScreenId = 1;

async function postChat(body: unknown): Promise<ChatResponse> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error ?? "Something went wrong. Please try again.");
  return json as ChatResponse;
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("I couldn't read that file."));
    reader.readAsDataURL(file);
  });
}

export default function EchoShow() {
  const scale = useFitScale(STAGE_WIDTH, STAGE_HEIGHT);
  const speechSupported = useSpeechSupported();

  const [mode, setMode] = useState<Mode>("idle");
  // The screen on show, and the previous one while it fades out.
  const [view, setView] = useState<{ screen: Screen; leaving: Screen | null }>({
    screen: { id: 0, kind: "home" },
    leaving: null,
  });
  const { screen, leaving } = view;
  const [caption, setCaption] = useState("");
  const [input, setInput] = useState("");
  const [home, setHome] = useState<HomeDeadlines>({ status: "loading" });

  const history = useRef<ChatTurn[]>([]);
  const stopListeningRef = useRef<(() => void) | null>(null);
  // Each request gets a number, so a slow old answer never replaces a newer one.
  const requestId = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);

  // Switches screens with a short cross-fade: the old one stays briefly to fade out.
  const showScreen = useCallback((next: Screen) => {
    setView((current) =>
      current.screen.kind === "home" && next.kind === "home" ? current : { screen: next, leaving: current.screen },
    );
  }, []);

  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => setView((current) => ({ ...current, leaving: null })), SCREEN_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  const loadHome = useCallback(async () => {
    try {
      const result = await postChat({ call: { name: "list_deadlines", arguments: {} } });
      const items = (result.cards[0]?.data.deadlines as DeadlineItem[] | undefined) ?? [];
      setHome({ status: "ready", items });
    } catch {
      setHome({ status: "error" });
    }
  }, []);

  useEffect(() => {
    // The first fetch runs after mount; loadHome only sets state once it has an answer.
    const timer = window.setTimeout(loadHome, 0);
    return () => window.clearTimeout(timer);
  }, [loadHome]);

  const answer = useCallback(
    async (query: string, request: () => Promise<ChatResponse>) => {
      const id = ++requestId.current;
      stopSpeaking();
      setMode("thinking");
      setCaption(query);

      let reply: string;
      try {
        const result = await request();
        if (id !== requestId.current) return;
        history.current = [...history.current, result.turn].slice(-MAX_HISTORY_TURNS);
        reply = result.reply;
        showScreen({
          id: nextScreenId++,
          kind: "answer",
          query,
          reply,
          cards: result.cards,
          tools: [...new Set(result.turn.tools.map((tool) => tool.name))],
        });
        if (result.cards.some((card) => card.kind === "document")) void loadHome();
      } catch (error) {
        if (id !== requestId.current) return;
        reply = error instanceof Error ? error.message : "Something went wrong. Please try again.";
        showScreen({ id: nextScreenId++, kind: "answer", query, reply, cards: [], tools: [], error: true });
      }

      setCaption("");
      setMode("speaking");
      await speak(reply);
      if (id === requestId.current) setMode("idle");
    },
    [showScreen, loadHome],
  );

  const ask = useCallback(
    (text: string) => {
      const message = text.trim();
      if (!message) return;
      void answer(message, () => postChat({ message, history: history.current }));
    },
    [answer],
  );

  // Same document and intent, firm tone: called directly, so the model can't change them.
  function makeFirmer(draft: DraftData) {
    void answer("Make it firmer.", () =>
      postChat({
        call: {
          name: "draft_reply",
          arguments: { document_id: draft.document.id, intent: draft.intent, tone: "firm" },
        },
      }),
    );
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    ask(input);
    setInput("");
  }

  function toggleListening() {
    if (mode === "listening") {
      stopListeningRef.current?.();
      return;
    }
    requestId.current++; // ignore any answer still on its way
    stopSpeaking();
    setMode("listening");
    setCaption("");
    stopListeningRef.current = startListening({
      onInterim: setCaption,
      onFinal: (text) => ask(text),
      onError: (message) => {
        showScreen({ id: nextScreenId++, kind: "answer", query: "", reply: message, cards: [], tools: [], error: true });
      },
      onEnd: () => {
        stopListeningRef.current = null;
        setMode((current) => (current === "listening" ? "idle" : current));
      },
    });
  }

  async function onFile(file: File | undefined) {
    if (fileInput.current) fileInput.current.value = "";
    if (!file) return;
    const query = `Save this: ${file.name}`;
    if (!UPLOAD_TYPES.includes(file.type)) {
      void answer(query, () => Promise.reject(new Error("Please upload a JPEG, PNG or PDF.")));
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      void answer(query, () => Promise.reject(new Error("That file is too big. The limit is 3 MB.")));
      return;
    }
    void answer(query, async () =>
      postChat({
        call: { name: "add_document", arguments: { file_base64: await readAsBase64(file), mime_type: file.type } },
      }),
    );
  }

  function goHome() {
    requestId.current++;
    stopSpeaking();
    stopListeningRef.current?.();
    setMode("idle");
    setCaption("");
    showScreen({ id: nextScreenId++, kind: "home" });
  }

  const busy = mode === "thinking";
  const stageStyle = {
    "--scale": scale ?? 1,
    width: STAGE_WIDTH * (scale ?? 1),
    height: STAGE_HEIGHT * (scale ?? 1),
  } as CSSProperties;

  return (
    <main className={styles.page}>
      <div className={`${styles.stageBox} ${scale === null ? styles.hidden : ""}`} style={stageStyle}>
        <div className={styles.stage}>
          <p className={styles.banner}>
            <span className={styles.bannerDot} aria-hidden="true" />
            Simulated Alexa+ experience · Duly runs as a standard MCP server
          </p>

          <div className={styles.device}>
            <span className={styles.camera} aria-hidden="true" />
            <div className={styles.screen}>
              <TopBar showHome={screen.kind !== "home"} onHome={goHome} />
              {leaving && (
                <div key={leaving.id} className={`${styles.screenLayer} ${styles.screenExit}`} aria-hidden="true">
                  <ScreenView screen={leaving} home={home} busy={busy} onFirmer={() => {}} />
                </div>
              )}
              <div
                key={screen.id}
                className={`${styles.screenLayer} ${styles.screenEnter} ${busy || mode === "listening" ? styles.dimmed : ""}`}
                aria-live="polite"
              >
                <ScreenView screen={screen} home={home} busy={busy} onFirmer={makeFirmer} />
              </div>
              <Caption mode={mode} text={caption} />
              <div className={`${styles.lightBar} ${styles[`light_${mode}`]}`} aria-hidden="true" />
            </div>
          </div>

          <form className={styles.controls} onSubmit={onSubmit}>
            <button
              type="button"
              className={`${styles.mic} ${mode === "listening" ? styles.micActive : ""}`}
              onClick={toggleListening}
              disabled={!speechSupported || busy}
              aria-label={mode === "listening" ? "Stop listening" : "Talk to Alexa"}
              title={speechSupported ? "Talk (en-US)" : "Voice input needs Chrome or Edge. Type instead."}
            >
              <MicIcon />
            </button>
            <input
              className={styles.textInput}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Type what you'd say to Alexa…"
              maxLength={500}
              aria-label="Type a question"
            />
            <button type="submit" className={styles.send} disabled={busy || !input.trim()} aria-label="Send">
              <SendIcon />
            </button>
            <button
              type="button"
              className={styles.upload}
              onClick={() => fileInput.current?.click()}
              disabled={busy}
            >
              <UploadIcon /> Add document
            </button>
            <input
              ref={fileInput}
              type="file"
              accept={UPLOAD_TYPES.join(",")}
              className={styles.hiddenInput}
              onChange={(event) => onFile(event.target.files?.[0])}
            />
          </form>

          <div className={styles.suggestions}>
            {SUGGESTIONS.map((text) => (
              <button key={text} type="button" className={styles.chip} onClick={() => ask(text)} disabled={busy}>
                {text}
              </button>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}

function TopBar({ showHome, onHome }: { showHome: boolean; onHome: () => void }) {
  const now = useClock();
  return (
    <div className={styles.topBar}>
      <button type="button" className={styles.brand} onClick={onHome} disabled={!showHome} aria-label="Home">
        {showHome && <BackIcon />}
        <span>Duly</span>
      </button>
      <span className={`${styles.topTime} ${showHome ? "" : styles.invisible}`}>{now ? formatTime(now) : ""}</span>
    </div>
  );
}

function ScreenView({
  screen,
  home,
  busy,
  onFirmer,
}: {
  screen: Screen;
  home: HomeDeadlines;
  busy: boolean;
  onFirmer: (draft: DraftData) => void;
}) {
  if (screen.kind === "home") return <HomeScreen home={home} />;
  return (
    <div className={`${styles.answer} ${screen.cards.length === 0 ? styles.answerSolo : ""}`}>
      <div className={styles.answerText}>
        {screen.query && <p className={`${styles.query} ${styles.enter}`}>“{screen.query}”</p>}
        <p className={`${styles.reply} ${replySize(screen.reply)} ${screen.error ? styles.replyError : ""} ${styles.enter}`}>
          {screen.reply}
        </p>
        {screen.tools.length > 0 && (
          <p className={`${styles.toolTag} ${styles.enter}`}>
            via MCP · {screen.tools.join(", ")}
          </p>
        )}
      </div>
      {screen.cards.length > 0 && (
        <div className={styles.answerCards}>
          {screen.cards.map((card) => (
            <CardView key={card.kind} card={card} busy={busy} onFirmer={onFirmer} />
          ))}
        </div>
      )}
    </div>
  );
}

function CardView({ card, busy, onFirmer }: { card: Card; busy: boolean; onFirmer: (draft: DraftData) => void }) {
  switch (card.kind) {
    case "deadlines":
      return <DeadlinesCard data={card.data} />;
    case "document":
      return <DocumentCard data={card.data} />;
    case "warranty":
      return <WarrantyCard data={card.data} />;
    case "draft":
      return <DraftCard data={card.data} onFirmer={onFirmer} busy={busy} />;
    case "explanation":
      return <ExplanationCard data={card.data} />;
    case "matches":
      return <MatchesCard data={card.data} />;
  }
}

function HomeScreen({ home }: { home: HomeDeadlines }) {
  const now = useClock();
  const greeting = !now ? "Hello" : now.getHours() < 12 ? "Good morning" : now.getHours() < 18 ? "Good afternoon" : "Good evening";
  return (
    <div className={styles.home}>
      <div className={styles.homeLeft}>
        <div className={styles.clock}>
          {now ? formatTime(now) : " "}
          <span className={styles.clockSuffix}>{now ? (now.getHours() < 12 ? "AM" : "PM") : ""}</span>
        </div>
        <div className={styles.homeDate}>
          {now ? now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) : " "}
        </div>
        <div className={styles.homeHint}>
          <span className={styles.homeGreeting}>{greeting}.</span> Try “Alexa, what do I need to pay this month?”
        </div>
      </div>
      <div className={styles.homeRight}>
        <div className={styles.eyebrow}>Coming up</div>
        <div className={styles.stack}>
          {home.status === "loading" &&
            Array.from({ length: HOME_DEADLINES }, (_, i) => <div key={i} className={`${styles.card} ${styles.skeleton}`} />)}
          {home.status === "error" && <div className={`${styles.card} ${styles.emptyCard}`}>Couldn’t load deadlines.</div>}
          {home.status === "ready" && home.items.length === 0 && (
            <div className={`${styles.card} ${styles.emptyCard}`}>Nothing due in the next 30 days.</div>
          )}
          {home.status === "ready" &&
            home.items
              .slice(0, HOME_DEADLINES)
              .map((item, i) => <DeadlineRow key={`${item.date}-${item.description}`} item={item} index={i} compact />)}
        </div>
      </div>
    </div>
  );
}

function Caption({ mode, text }: { mode: Mode; text: string }) {
  const visible = mode === "listening" || mode === "thinking";
  return (
    <div className={`${styles.caption} ${visible ? styles.captionVisible : ""}`} aria-live="polite">
      {mode === "listening" && (text || "Listening…")}
      {mode === "thinking" && (
        <>
          {text && <span className={styles.captionQuery}>“{text}”</span>}
          <span className={styles.dots} aria-label="Thinking">
            <i />
            <i />
            <i />
          </span>
        </>
      )}
    </div>
  );
}

// Long spoken answers get a smaller font so they still fit next to the cards.
function replySize(text: string): string {
  if (text.length > 170) return styles.replyLong;
  if (text.length > 100) return styles.replyMedium;
  return "";
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }).replace(/\s?[AP]M$/, "");
}

function MicIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="8.5" y="3" width="7" height="12" rx="3.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 10h11M10.5 5l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path d="M9 12V3M5 6.5 9 2.5l4 4M3 12.5v1.5A1.5 1.5 0 0 0 4.5 15.5h9A1.5 1.5 0 0 0 15 14v-1.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M10 3.5 5.5 8l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
