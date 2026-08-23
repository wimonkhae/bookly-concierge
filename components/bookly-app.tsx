"use client";

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";

type Session = { sessionId: string; customerId: string };
type Message = { role: "assistant" | "user"; text: string };
type TraceEvent = { id: string; type: string; detail: string };
type PreparedAudio = { text: string; audio: HTMLAudioElement; url: string };

function getGreeting(firstName: string): string {
  return `Hi ${firstName}, I’m Bookly Concierge. How can I help today?`;
}

function formatSpokenDate(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return value;
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function getSpeechText(chatText: string): string {
  return chatText
    .replace(/\border is\s+(?=ORD-[A-Z0-9-]+)/gi, "order ")
    .replace(/\b(?:ORD|RMA)-[A-Z0-9-]+\b/gi, "")
    .replace(/\bITEM-[A-Z0-9-]+\b/gi, "")
    .replace(/\b[A-Z]{2,5}-\d{5,}\b/g, "")
    .replace(/[-\s]*(?:Order ID|Return ID|Item ID|Tracking number|Tracking):\s*/gi, "")
    .replace(/\(\s*\)/g, "")
    .replace(/Item:\s*/gi, "for ")
    .replace(/Refund status:\s*Refunded/gi, "It has been refunded")
    .replace(/Refund amount:\s*/gi, "The refund amount was ")
    .replace(/Processed on:\s*/gi, "It was processed on ")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, formatSpokenDate)
    .replace(/\s*[-•]\s*/g, ". ")
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/\.\s*\./g, ".")
    .trim();
}

function getChatFailureMessage(errorCode?: string): string {
  if (errorCode === "OPENAI_API_KEY_MISSING") {
    return "The Bookly Concierge is not configured yet. Restart the local server after setting the API key.";
  }

  if (errorCode === "UNAUTHENTICATED") {
    return "Your Bookly demo session has expired. Please sign in again.";
  }

  if (errorCode === "AGENT_UNAVAILABLE") {
    return "The Concierge service is unavailable right now. Please try again in a moment.";
  }

  return "I’m having trouble reaching Bookly right now. Please try again in a moment.";
}

const books = [
  ["Orbital", "Samantha Harvey", "£14.99", "#f3d6a5"],
  ["Wolf Hall", "Hilary Mantel", "£18.99", "#c4dcc7"],
  ["The Midnight Library", "Matt Haig", "£10.99", "#a8c5df"],
  ["Klara and the Sun", "Kazuo Ishiguro", "£16.99", "#ebc1ae"],
  ["The Sea", "John Banville", "£12.50", "#b8d3d1"],
  ["Tomorrow, and Tomorrow, and Tomorrow", "Gabrielle Zevin", "£15.99", "#e8bcb6"],
] as const;

export function BooklyApp() {
  const [session, setSession] = useState<Session>();
  const [name, setName] = useState("Sarah");
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isConciergeOpen, setIsConciergeOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [message, setMessage] = useState("");
  const [previousResponseId, setPreviousResponseId] = useState<string>();
  const [isSending, setIsSending] = useState(false);
  const [showTrace, setShowTrace] = useState(false);
  const [traceEvents, setTraceEvents] = useState<TraceEvent[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(true);
  const recorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);
  const messagesRef = useRef<HTMLDivElement>(null);
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const activeAudioUrlRef = useRef<string | undefined>(undefined);
  const greetingAudioRef = useRef<PreparedAudio | undefined>(undefined);
  const voiceEnabledRef = useRef(true);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isConciergeOpen) {
      messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [isConciergeOpen, isSending, messages]);

  async function signIn(customerId: string, firstName: string) {
    setIsSigningIn(true);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerId }),
    });
    const result = await response.json();
    setIsSigningIn(false);

    if (result.success) {
      setSession(result.session);
      setName(firstName);
      setMessages([{ role: "assistant", text: getGreeting(firstName) }]);
      void preloadGreetingAudio(getGreeting(firstName)).catch(() => undefined);
    }
  }

  function playAudio(audio: HTMLAudioElement, url: string) {
    activeAudioRef.current = audio;
    activeAudioUrlRef.current = url;
    audio.onended = () => {
      URL.revokeObjectURL(url);
      if (activeAudioRef.current === audio) {
        activeAudioRef.current = null;
        activeAudioUrlRef.current = undefined;
      }
    };

    return audio.play();
  }

  async function preloadGreetingAudio(text: string) {
    const response = await fetch("/api/audio/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      return;
    }

    const url = URL.createObjectURL(await response.blob());
    if (greetingAudioRef.current) {
      URL.revokeObjectURL(greetingAudioRef.current.url);
    }
    greetingAudioRef.current = { text, audio: new Audio(url), url };
  }

  async function speak(text: string) {
    if (!voiceEnabledRef.current) {
      return;
    }

    const response = await fetch("/api/audio/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      return;
    }

    const url = URL.createObjectURL(await response.blob());

    if (!voiceEnabledRef.current) {
      URL.revokeObjectURL(url);
      return;
    }

    await playAudio(new Audio(url), url).catch(() => undefined);
  }

  function toggleVoiceReplies() {
    const nextVoiceEnabled = !voiceEnabledRef.current;
    voiceEnabledRef.current = nextVoiceEnabled;
    setIsVoiceEnabled(nextVoiceEnabled);

    if (!nextVoiceEnabled && activeAudioRef.current) {
      activeAudioRef.current.pause();
    }

    if (nextVoiceEnabled && activeAudioRef.current) {
      void activeAudioRef.current.play().catch(() => undefined);
    }
  }

  function toggleConcierge() {
    if (!isConciergeOpen) {
      const greeting = getGreeting(name);
      const preparedGreeting = greetingAudioRef.current;

      if (voiceEnabledRef.current && preparedGreeting?.text === greeting) {
        greetingAudioRef.current = undefined;
        void playAudio(preparedGreeting.audio, preparedGreeting.url).catch(() => undefined);
      } else {
        void speak(greeting);
      }
    }

    setIsConciergeOpen((open) => !open);
  }

  async function sendText(text: string, playVoice = true) {

    if (!text || !session || isSending) {
      return;
    }

    setIsSending(true);
    setMessages((current) => [...current, { role: "user", text }]);

    const response = await fetch("/api/concierge/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: session.sessionId, message: text, previousResponseId }),
    });
    const result = await response.json();

    if (result.success) {
      setMessages((current) => [...current, { role: "assistant", text: result.text }]);
      setPreviousResponseId(result.responseId);
      if (playVoice && voiceEnabledRef.current) {
        void speak(getSpeechText(result.text));
      }
    } else {
      setMessages((current) => [
        ...current,
        { role: "assistant", text: getChatFailureMessage(result.errorCode) },
      ]);
    }

    if (result.traceId) {
      const traceResponse = await fetch(`/api/concierge/trace?traceId=${result.traceId}`);
      const traceResult = await traceResponse.json();
      setTraceEvents(traceResult.trace?.events ?? []);
    }

    setIsSending(false);
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    const text = message.trim();
    setMessage("");
    if (composerRef.current) {
      composerRef.current.style.height = "auto";
    }
    await sendText(text);
  }

  function updateMessage(event: ChangeEvent<HTMLTextAreaElement>) {
    const composer = event.currentTarget;
    setMessage(composer.value);
    composer.style.height = "auto";
    composer.style.height = `${Math.min(composer.scrollHeight, 128)}px`;
  }

  async function toggleRecording() {
    if (recorder.current?.state === "recording") {
      recorder.current.stop();
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const nextRecorder = new MediaRecorder(stream);
    audioChunks.current = [];
    recorder.current = nextRecorder;
    nextRecorder.ondataavailable = (event) => audioChunks.current.push(event.data);
    nextRecorder.onstop = async () => {
      setIsRecording(false);
      stream.getTracks().forEach((track) => track.stop());
      const formData = new FormData();
      formData.append("audio", new Blob(audioChunks.current, { type: nextRecorder.mimeType }), "bookly-message.webm");
      const response = await fetch("/api/audio/transcribe", { method: "POST", body: formData });
      const result = await response.json();

      if (result.success) {
        await sendText(result.text, true);
      }
    };
    nextRecorder.start();
    setIsRecording(true);
  }

  if (!session) {
    return (
      <main className="login-shell">
        <section className="login-card">
          <p className="eyebrow">BOOKLY ONLINE BOOKSTORE</p>
          <h1>Stories worth keeping.</h1>
          <p className="login-copy">Sign in to browse your shelf and receive personalised order support.</p>
          <button className="primary-button" disabled={isSigningIn} onClick={() => signIn("CUST-001", "Sarah")}>
            {isSigningIn ? "Opening Bookly..." : "Continue as Sarah Chen"}
          </button>
          <div className="demo-users">
            <span>Demo accounts</span>
            <button onClick={() => signIn("CUST-002", "Daniel")}>Daniel Ortiz</button>
            <button onClick={() => signIn("CUST-003", "Maya")}>Maya Patel</button>
          </div>
        </section>
        <p className="login-note">A focused prototype for post-purchase Bookly support.</p>
      </main>
    );
  }

  return (
    <main className="store-shell">
      <header className="store-header">
        <a className="wordmark" href="#top">bookly<span>.</span></a>
        <nav><a href="#new">New in</a><a href="#fiction">Fiction</a><a href="#non-fiction">Non-fiction</a><a href="#gifts">Gifts</a></nav>
        <div className="account-area"><span>Hi, {name}</span><button aria-label="Cart">Bag (0)</button></div>
      </header>

      <section className="hero" id="top">
        <p className="eyebrow">THE LATE-SUMMER EDIT</p>
        <h1>A good book changes the weather.</h1>
        <p>New arrivals, perennial favourites, and the small pleasures of a well-stocked shelf.</p>
        <button className="dark-button">Explore the edit</button>
      </section>

      <section className="shelf" id="new">
        <div className="section-heading"><div><p className="eyebrow">JUST IN</p><h2>On the nightstand</h2></div><button>See all books</button></div>
        <div className="book-grid">
          {books.map(([title, author, price, colour]) => (
            <article className="book-card" key={title}>
              <div className="book-cover" style={{ backgroundColor: colour }}><span>{title}</span><small>{author}</small></div>
              <h3>{title}</h3><p>{author}</p><strong>{price}</strong>
            </article>
          ))}
        </div>
      </section>

      <section className="membership"><div><p className="eyebrow">BOOKLY PLUS</p><h2>More time for reading.</h2></div><p>Priority delivery, member-only editions, and a little extra help whenever you need it.</p></section>

      <button className="concierge-launcher" onClick={toggleConcierge}>
        <span className="concierge-mark">B</span><span><strong>Bookly Concierge</strong><small>Order help, made personal</small></span>
      </button>

      {isConciergeOpen && (
        <aside className="concierge-panel" aria-label="Bookly Concierge">
          <div className="concierge-header">
            <div>
              <p className="eyebrow">BOOKLY CONCIERGE</p>
              <h2>How can I help?</h2>
            </div>
            <button onClick={() => setIsConciergeOpen(false)} aria-label="Close concierge">×</button>
          </div>
          <div className="messages" ref={messagesRef}>
            {messages.map((item, index) => <p className={`message ${item.role}`} key={`${item.role}-${index}`}>{item.text}</p>)}
            {isSending && <p className="message assistant loading">Checking Bookly…</p>}
          </div>
          <form className="chat-form" onSubmit={sendMessage}>
            <textarea ref={composerRef} value={message} onChange={updateMessage} rows={1} placeholder="Ask about an order or return" aria-label="Message Bookly Concierge" />
            <button className={`microphone ${isRecording ? "recording" : ""}`} type="button" onClick={toggleRecording} aria-label="Record voice message">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Z" />
                <path d="M18 11a6 6 0 0 1-12 0M12 17v4M8 21h8" />
              </svg>
            </button>
            <button
              className={`voice-toggle ${isVoiceEnabled ? "" : "muted"}`}
              type="button"
              onClick={toggleVoiceReplies}
              aria-label={isVoiceEnabled ? "Mute Bookly voice replies" : "Unmute Bookly voice replies"}
              aria-pressed={!isVoiceEnabled}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 10v4h4l5 4V6L8 10H4Z" />
                {isVoiceEnabled ? <path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" /> : <path d="m16 10 4 4m0-4-4 4" />}
              </svg>
            </button>
            <button disabled={isSending || !message.trim()} aria-label="Send message">↑</button>
          </form>
          <label className="trace-toggle"><input type="checkbox" checked={showTrace} onChange={(event) => setShowTrace(event.target.checked)} /> Developer view</label>
          {showTrace && <div className="trace-panel">{traceEvents.length ? traceEvents.map((event) => <p key={event.id}><strong>{event.type.replaceAll("_", " ")}</strong>{event.detail}</p>) : <p>Send a message to inspect the agent workflow.</p>}</div>}
        </aside>
      )}
    </main>
  );
}
