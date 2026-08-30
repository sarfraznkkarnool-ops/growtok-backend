import React, { useState, useRef, useEffect, useCallback } from "react";
import { Heart, MessageCircle, Share2, Plus, Home, Compass, User, Search, X, Sprout, Music2, LogOut, ArrowLeft, Volume2, VolumeX, Pencil, Check } from "lucide-react";

// ---------------------------------------------------------------------------
// Design tokens
// ---------------------------------------------------------------------------
const T = {
  bg: "#141310",
  card: "#1d1c17",
  paper: "#F3EFE4",
  paperDim: "#B9B4A6",
  lime: "#B7F26A",
  limeDim: "#7FA84A",
  coral: "#FF5E62",
  line: "#2C2A22",
  danger: "#FF5E62",
};
const FONT = "'DM Sans', sans-serif";

// Backend is fixed — no need to ask the person for it on the login screen.
const API_BASE = "https://growtok-backend.onrender.com";

// ---------------------------------------------------------------------------
// AdSense
// ---------------------------------------------------------------------------
const ADSENSE_CLIENT_ID = "ca-pub-2598607795840843";
const ADSENSE_SLOT_ID = "2569192662";        // in-feed ad unit slot id — create in AdSense once approved
const ADSENSE_BANNER_SLOT_ID = "2569192662"; // real display/banner ad unit slot id
const ADSENSE_READY = Boolean(ADSENSE_CLIENT_ID && ADSENSE_SLOT_ID);
const ADSENSE_BANNER_READY = Boolean(ADSENSE_CLIENT_ID && ADSENSE_BANNER_SLOT_ID);

// ---------------------------------------------------------------------------
// Ads — client-side feed rule: splice one in after every REELS_PER_AD videos.
// ---------------------------------------------------------------------------
const MOCK_ADS = [
  { advertiser: "Nimbus Shoes", headline: "Built for your next 10K", cta: "Shop now", durationSeconds: 6, gradient: "linear-gradient(160deg,#3a2a12,#141310 70%)" },
  { advertiser: "Sprout Bank", headline: "Save on autopilot", cta: "Get the app", durationSeconds: 8, gradient: "linear-gradient(160deg,#12233a,#141310 70%)" },
];
const REELS_PER_AD = 25;

function withAds(videos, adPool = MOCK_ADS) {
  const out = [];
  let adIdx = 0;
  videos.forEach((v, i) => {
    out.push({ kind: "video", ...v });
    if ((i + 1) % REELS_PER_AD === 0) {
      out.push({ kind: "ad", id: `ad-${i}-${Date.now()}`, ...adPool[adIdx % adPool.length] });
      adIdx += 1;
    }
  });
  return out;
}

function abbreviate(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n || 0);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function Avatar({ user, size = 36 }) {
  if (user?.avatar_base64) {
    return (
      <img
        src={`data:image/jpeg;base64,${user.avatar_base64}`}
        alt={user.username}
        style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
      />
    );
  }
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: T.lime, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: T.bg, fontFamily: FONT, fontSize: size * 0.4, flexShrink: 0 }}>
      {(user?.username || "?")[0].toUpperCase()}
    </div>
  );
}

// ---------------------------------------------------------------------------
// API layer — with automatic access-token refresh on a stale 401.
// ---------------------------------------------------------------------------
function useApi(tokens, setTokens) {
  const tokensRef = useRef(tokens);
  useEffect(() => { tokensRef.current = tokens; }, [tokens]);

  const rawFetch = useCallback(async (path, { method = "GET", body, accessToken } = {}) => {
    const headers = { "Content-Type": "application/json" };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    return fetch(`${API_BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  }, []);

  const parse = async (res) => {
    if (res.status === 204) return null;
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) {
      const msg = data?.detail || `Request failed (${res.status})`;
      const err = new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
      err.status = res.status;
      throw err;
    }
    return data;
  };

  const request = useCallback(async (path, { method = "GET", body, auth = true } = {}) => {
    const current = tokensRef.current;
    let res = await rawFetch(path, { method, body, accessToken: auth ? current?.access_token : null });

    if (res.status === 401 && auth && current?.refresh_token) {
      try {
        const refreshRes = await rawFetch("/auth/refresh", { method: "POST", body: { refresh_token: current.refresh_token } });
        if (refreshRes.ok) {
          const fresh = await refreshRes.json();
          const nextTokens = { access_token: fresh.access_token, refresh_token: fresh.refresh_token, user: fresh.user };
          tokensRef.current = nextTokens;
          setTokens(nextTokens);
          res = await rawFetch(path, { method, body, accessToken: fresh.access_token });
        } else {
          setTokens(null);
        }
      } catch (_) { setTokens(null); }
    }
    return parse(res);
  }, [rawFetch, setTokens]);

  return {
    signup: (email, username, password) => request("/auth/signup", { method: "POST", body: { email, username, password }, auth: false }),
    login: (email, password) => request("/auth/login", { method: "POST", body: { email, password }, auth: false }),
    me: () => request("/auth/me"),
    updateMe: (data) => request("/users/me", { method: "PUT", body: data }),
    getFeed: (skip = 0, limit = 30) => request(`/videos/feed?skip=${skip}&limit=${limit}`),
    getMyVideos: () => request("/videos/me"),
    uploadBatch: (videos) => request("/videos/batch", { method: "POST", body: { videos } }),
    like: (id) => request(`/videos/${id}/like`, { method: "POST" }),
    unlike: (id) => request(`/videos/${id}/like`, { method: "DELETE" }),
    getComments: (videoId) => request(`/videos/${videoId}/comments`),
    addComment: (videoId, text) => request(`/videos/${videoId}/comments`, { method: "POST", body: { text } }),
    deleteComment: (videoId, commentId) => request(`/videos/${videoId}/comments/${commentId}`, { method: "DELETE" }),
    follow: (username) => request(`/users/${username}/follow`, { method: "POST" }),
    unfollow: (username) => request(`/users/${username}/follow`, { method: "DELETE" }),
    getUser: (username) => request(`/users/${username}`),
  };
}

// ---------------------------------------------------------------------------
// Connect / Auth screen
// ---------------------------------------------------------------------------
function ConnectScreen({ onAuthed }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const api = useApi(null, () => {});

  const submit = async () => {
    setErr(""); setBusy(true);
    try {
      const res = mode === "login" ? await api.login(email, password) : await api.signup(email, username, password);
      onAuthed({ access_token: res.access_token, refresh_token: res.refresh_token, user: res.user });
    } catch (e) { setErr(e.message || "Something went wrong"); } finally { setBusy(false); }
  };

  const inputStyle = { width: "100%", boxSizing: "border-box", background: T.bg, border: `1px solid ${T.line}`, borderRadius: 12, padding: "11px 14px", color: T.paper, fontFamily: FONT, fontSize: 14, outline: "none", marginBottom: 10 };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 26px", boxSizing: "border-box" }}>
      <Sprout size={34} color={T.lime} style={{ marginBottom: 10 }} />
      <h2 style={{ color: T.paper, fontFamily: FONT, fontSize: 20, fontWeight: 700, margin: "0 0 4px" }}>{mode === "login" ? "Log in to GrowTok" : "Create an account"}</h2>
      <p style={{ color: T.paperDim, fontFamily: FONT, fontSize: 12.5, margin: "0 0 18px" }}>{mode === "login" ? "Welcome back" : "Join GrowTok"}</p>
      <input style={inputStyle} placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      {mode === "signup" && <input style={inputStyle} placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />}
      <input style={inputStyle} placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      {err && <div style={{ color: T.danger, fontSize: 12.5, fontFamily: FONT, marginBottom: 10, lineHeight: 1.4 }}>{err}</div>}
      <button onClick={submit} disabled={busy || !email || !password || (mode === "signup" && !username)} style={{ background: T.lime, color: T.bg, border: "none", borderRadius: 12, padding: "12px 0", fontFamily: FONT, fontWeight: 700, fontSize: 14.5, cursor: "pointer", opacity: busy ? 0.7 : 1, marginBottom: 12 }}>
        {busy ? "Please wait…" : mode === "login" ? "Log in" : "Sign up"}
      </button>
      <button onClick={() => { setErr(""); setMode(mode === "login" ? "signup" : "login"); }} style={{ background: "none", border: "none", color: T.paperDim, fontFamily: FONT, fontSize: 13, cursor: "pointer" }}>
        {mode === "login" ? "No account? Sign up" : "Have an account? Log in"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ads
// ---------------------------------------------------------------------------
function AdSlide({ ad, onSkip }) {
  const [elapsed, setElapsed] = useState(0);
  const skippableAt = Math.min(5, ad.durationSeconds);

  useEffect(() => {
    setElapsed(0);
    const start = Date.now();
    const tick = setInterval(() => {
      const secs = (Date.now() - start) / 1000;
      setElapsed(secs);
      if (secs >= ad.durationSeconds) { clearInterval(tick); onSkip(); }
    }, 100);
    return () => clearInterval(tick);
  }, [ad]);

  const remaining = Math.max(0, Math.ceil(ad.durationSeconds - elapsed));
  const canSkip = elapsed >= skippableAt;
  const progress = Math.min(1, elapsed / ad.durationSeconds);

  return (
    <div style={{ position: "relative", height: "100%", width: "100%", scrollSnapAlign: "start", scrollSnapStop: "always", flexShrink: 0, background: ad.gradient, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "0 32px", boxSizing: "border-box" }}>
      <span style={{ position: "absolute", top: 16, left: 16, color: T.paperDim, fontSize: 11, letterSpacing: 1, fontFamily: FONT, border: `1px solid ${T.line}`, borderRadius: 4, padding: "3px 7px" }}>SPONSORED</span>
      <div style={{ width: 64, height: 64, borderRadius: 16, background: T.lime, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 700, color: T.bg, fontFamily: FONT, marginBottom: 16 }}>{ad.advertiser[0]}</div>
      <div style={{ color: T.paperDim, fontSize: 13, fontFamily: FONT, marginBottom: 6 }}>{ad.advertiser}</div>
      <div style={{ color: T.paper, fontSize: 20, fontWeight: 700, fontFamily: FONT, lineHeight: 1.3, marginBottom: 22 }}>{ad.headline}</div>
      <button style={{ background: T.lime, color: T.bg, border: "none", borderRadius: 22, padding: "11px 26px", fontFamily: FONT, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>{ad.cta}</button>
      <div style={{ position: "absolute", bottom: 96, left: 24, right: 24, display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1, height: 3, borderRadius: 2, background: T.line, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${progress * 100}%`, background: T.lime, transition: "width 100ms linear" }} />
        </div>
        {canSkip ? (
          <button onClick={onSkip} style={{ background: "none", border: `1px solid ${T.line}`, color: T.paper, borderRadius: 14, padding: "5px 12px", fontSize: 12, fontFamily: FONT, cursor: "pointer" }}>Skip</button>
        ) : (
          <span style={{ color: T.paperDim, fontSize: 12, fontFamily: FONT }}>{remaining}s</span>
        )}
      </div>
    </div>
  );
}

function ensureAdSenseScriptLoaded() {
  const existing = document.querySelector('script[data-adsbygoogle-loader]');
  if (!existing) {
    const script = document.createElement("script");
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT_ID}`;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.setAttribute("data-adsbygoogle-loader", "1");
    document.head.appendChild(script);
  }
}

function AdSenseSlide() {
  const pushed = useRef(false);
  useEffect(() => {
    if (pushed.current) return;
    pushed.current = true;
    ensureAdSenseScriptLoaded();
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (_) {}
  }, []);

  return (
    <div style={{ height: "100%", width: "100%", scrollSnapAlign: "start", scrollSnapStop: "always", flexShrink: 0, background: T.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 16px", boxSizing: "border-box", position: "relative" }}>
      <span style={{ position: "absolute", top: 16, left: 16, color: T.paperDim, fontSize: 11, letterSpacing: 1, fontFamily: FONT, border: `1px solid ${T.line}`, borderRadius: 4, padding: "3px 7px" }}>SPONSORED</span>
      <ins className="adsbygoogle" style={{ display: "block", width: "100%", minHeight: 250 }} data-ad-client={ADSENSE_CLIENT_ID} data-ad-slot={ADSENSE_SLOT_ID} data-ad-format="fluid" data-full-width-responsive="true" />
    </div>
  );
}

function AdSenseBanner({ style }) {
  const pushed = useRef(false);
  useEffect(() => {
    if (!ADSENSE_BANNER_READY || pushed.current) return;
    pushed.current = true;
    ensureAdSenseScriptLoaded();
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (_) {}
  }, []);

  if (!ADSENSE_BANNER_READY) return null;

  return (
    <div style={{ width: "100%", minHeight: 90, background: T.card, border: `1px solid ${T.line}`, borderRadius: 10, overflow: "hidden", position: "relative", ...style }}>
      <span style={{ position: "absolute", top: 6, left: 8, color: T.paperDim, fontSize: 9.5, letterSpacing: 0.5, fontFamily: FONT, zIndex: 1 }}>SPONSORED</span>
      <ins className="adsbygoogle" style={{ display: "block", width: "100%" }} data-ad-client={ADSENSE_CLIENT_ID} data-ad-slot={ADSENSE_BANNER_SLOT_ID} data-ad-format="auto" data-full-width-responsive="true" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Comments drawer — with edit (delete-and-repost, since the API has no
// PATCH for comments; editing = swap the old comment for a new one).
// ---------------------------------------------------------------------------
function CommentsDrawer({ video, api, myUserId, onClose, onCountChange }) {
  const [comments, setComments] = useState([]);
  const [status, setStatus] = useState("loading");
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const load = useCallback(async () => {
    setStatus("loading");
    try { setComments((await api.getComments(video.id)) || []); setStatus("ready"); }
    catch (e) { setStatus("error"); }
  }, [api, video.id]);

  useEffect(() => { load(); }, [load]);

  const startEdit = (c) => { setEditingId(c.id); setText(c.text); };
  const cancelEdit = () => { setEditingId(null); setText(""); };

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed || posting) return;
    setPosting(true);
    try {
      if (editingId) {
        await api.deleteComment(video.id, editingId);
        const created = await api.addComment(video.id, trimmed);
        setComments((c) => [created, ...c.filter((x) => x.id !== editingId)]);
        setEditingId(null);
      } else {
        const created = await api.addComment(video.id, trimmed);
        setComments((c) => [created, ...c]);
        onCountChange?.(1);
      }
      setText("");
    } catch (_) {} finally { setPosting(false); }
  };

  const remove = async (commentId) => {
    try {
      await api.deleteComment(video.id, commentId);
      setComments((c) => c.filter((x) => x.id !== commentId));
      onCountChange?.(-1);
      if (editingId === commentId) cancelEdit();
    } catch (_) {}
  };

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 10, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)" }} />
      <div style={{ position: "relative", background: T.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "62%", display: "flex", flexDirection: "column", borderTop: `1px solid ${T.line}` }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 18px 12px", borderBottom: `1px solid ${T.line}` }}>
          <span style={{ color: T.paper, fontWeight: 700, fontFamily: FONT }}>{comments.length} comments</span>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={20} color={T.paperDim} /></button>
        </div>
        <div style={{ overflowY: "auto", padding: "12px 18px", display: "flex", flexDirection: "column", gap: 16, minHeight: 80 }}>
          {status === "loading" && <span style={{ color: T.paperDim, fontFamily: FONT, fontSize: 13 }}>Loading…</span>}
          {status === "error" && <span style={{ color: T.danger, fontFamily: FONT, fontSize: 13 }}>Couldn't load comments</span>}
          {status === "ready" && comments.length === 0 && <span style={{ color: T.paperDim, fontFamily: FONT, fontSize: 13 }}>No comments yet — say something</span>}
          {comments.map((c) => (
            <div key={c.id} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <Avatar user={c.user} size={30} />
              <div style={{ flex: 1 }}>
                <div style={{ color: T.paperDim, fontSize: 12.5, fontFamily: FONT, marginBottom: 2 }}>@{c.user.username}</div>
                <div style={{ color: T.paper, fontSize: 14, fontFamily: FONT }}>{c.text}</div>
              </div>
              {(c.is_owner || c.user.id === myUserId) && (
                <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                  <button onClick={() => startEdit(c)} style={{ background: "none", border: "none", cursor: "pointer", padding: 2 }}><Pencil size={13} color={T.paperDim} /></button>
                  <button onClick={() => remove(c.id)} style={{ background: "none", border: "none", cursor: "pointer", padding: 2 }}><X size={13} color={T.paperDim} /></button>
                </div>
              )}
            </div>
          ))}
        </div>
        <div style={{ padding: 14, borderTop: `1px solid ${T.line}` }}>
          {editingId && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ color: T.lime, fontSize: 12, fontFamily: FONT }}>Editing comment</span>
              <button onClick={cancelEdit} style={{ background: "none", border: "none", color: T.paperDim, fontSize: 12, fontFamily: FONT, cursor: "pointer" }}>Cancel</button>
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="Add a comment" style={{ flex: 1, boxSizing: "border-box", background: T.bg, border: `1px solid ${T.line}`, borderRadius: 20, padding: "10px 16px", color: T.paper, fontFamily: FONT, fontSize: 14, outline: "none" }} />
            <button onClick={submit} disabled={posting || !text.trim()} style={{ background: T.lime, color: T.bg, border: "none", borderRadius: 18, padding: "0 16px", fontFamily: FONT, fontWeight: 700, fontSize: 13, cursor: "pointer", opacity: posting || !text.trim() ? 0.6 : 1 }}>
              {editingId ? "Save" : "Post"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Action rail
// ---------------------------------------------------------------------------
function ActionRail({ video, liked, likeBusy, onLike, onComment, onShare }) {
  return (
    <div style={{ position: "absolute", right: 12, bottom: 96, display: "flex", flexDirection: "column", alignItems: "center", gap: 22, zIndex: 3 }}>
      <button onClick={onLike} disabled={likeBusy} aria-label={liked ? "Unlike" : "Like"} style={{ background: "none", border: "none", padding: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, cursor: "pointer", opacity: likeBusy ? 0.6 : 1 }}>
        <Heart size={30} fill={liked ? T.coral : "none"} stroke={liked ? T.coral : T.paper} strokeWidth={2} style={{ transform: liked ? "scale(1.12)" : "scale(1)", transition: "transform 160ms ease" }} />
        <span style={{ color: T.paper, fontSize: 12, fontWeight: 600, fontFamily: FONT }}>{abbreviate(video.likes_count)}</span>
      </button>
      <button onClick={onComment} aria-label="Comments" style={{ background: "none", border: "none", padding: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, cursor: "pointer" }}>
        <MessageCircle size={28} stroke={T.paper} strokeWidth={2} />
        <span style={{ color: T.paper, fontSize: 12, fontWeight: 600, fontFamily: FONT }}>{abbreviate(video.comments_count)}</span>
      </button>
      <button onClick={onShare} aria-label="Share" style={{ background: "none", border: "none", padding: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, cursor: "pointer" }}>
        <Share2 size={26} stroke={T.paper} strokeWidth={2} />
        <span style={{ color: T.paper, fontSize: 12, fontWeight: 600, fontFamily: FONT }}>{abbreviate(video.shares_count)}</span>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Feed slide — mute state is now owned by FeedScreen and passed in, so
// unmuting once stays unmuted as you swipe to the next reel.
// ---------------------------------------------------------------------------
function FeedSlide({ video, liked, likeBusy, isFollowing, followBusy, showFollow, isMuted, onToggleSound, onLike, onComment, onFollow, onShare, onOpenProfile }) {
  const src = video.video_url || (video.video_base64 ? `data:video/mp4;base64,${video.video_base64}` : null);

  return (
    <div style={{ position: "relative", height: "100%", width: "100%", scrollSnapAlign: "start", scrollSnapStop: "always", flexShrink: 0, background: "#000", overflow: "hidden" }}>
      {src ? (
        <video src={src} loop muted={isMuted} autoPlay playsInline style={{ width: "100%", height: "100%", objectFit: "cover", cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); onToggleSound(); }} />
      ) : (
        <div style={{ width: "100%", height: "100%", background: "linear-gradient(160deg,#2d3b1f,#141310 70%)" }} />
      )}

      {src && (
        <button onClick={onToggleSound} aria-label={isMuted ? "Unmute" : "Mute"} style={{ position: "absolute", top: 18, right: 18, zIndex: 4, background: "rgba(0,0,0,0.55)", border: `1px solid ${T.line}`, borderRadius: "50%", width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          {isMuted ? <VolumeX size={17} color={T.paper} /> : <Volume2 size={17} color={T.lime} />}
        </button>
      )}

      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(0,0,0,0.55), transparent 40%)", pointerEvents: "none" }} />

      <div style={{ position: "absolute", left: 16, right: 84, bottom: 28, zIndex: 3 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <button onClick={() => onOpenProfile(video.owner)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
            <Avatar user={video.owner} />
            <span style={{ color: T.paper, fontWeight: 700, fontFamily: FONT, fontSize: 15 }}>@{video.owner?.username}</span>
          </button>
          {showFollow && (
            <button onClick={onFollow} disabled={followBusy} style={{ marginLeft: 4, background: isFollowing ? "transparent" : T.lime, color: isFollowing ? T.paper : T.bg, border: isFollowing ? `1px solid ${T.paperDim}` : "none", borderRadius: 12, padding: "3px 11px", fontFamily: FONT, fontWeight: 700, fontSize: 11.5, cursor: "pointer", opacity: followBusy ? 0.6 : 1 }}>
              {isFollowing ? "Following" : "Follow"}
            </button>
          )}
        </div>
        <p style={{ color: T.paper, fontFamily: FONT, fontSize: 14.5, lineHeight: 1.4, margin: "0 0 10px" }}>{video.caption}</p>
        <div style={{ display: "flex", alignItems: "center", gap: 6, color: T.paperDim, fontSize: 12.5 }}>
          <Music2 size={13} />
          <span style={{ fontFamily: FONT }}>{video.sound_name}</span>
        </div>
      </div>

      <ActionRail video={video} liked={liked} likeBusy={likeBusy} onLike={onLike} onComment={onComment} onShare={onShare} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Creator profile — reels filtered from what's already loaded, since the
// API doesn't expose a public "videos by other user" endpoint.
// ---------------------------------------------------------------------------
function CreatorProfileScreen({ owner, videos, isOwnProfile, isFollowing, followBusy, onFollow, onBack }) {
  if (!owner) return null;
  const theirVideos = videos.filter((v) => v.owner?.username === owner.username);

  return (
    <div style={{ height: "100%", background: T.bg, position: "relative", zIndex: 30, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", padding: 16, borderBottom: `1px solid ${T.line}`, gap: 12, flexShrink: 0 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", color: T.paper, display: "flex" }}><ArrowLeft size={20} /></button>
        <span style={{ color: T.paper, fontWeight: 700, fontFamily: FONT, fontSize: 16 }}>@{owner.username}</span>
      </div>
      <div style={{ overflowY: "auto", flex: 1 }}>
        <div style={{ padding: "24px 20px 16px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <Avatar user={owner} size={76} />
          <div style={{ color: T.paper, fontWeight: 700, fontFamily: FONT, fontSize: 16 }}>@{owner.username}</div>
          {owner.bio && <div style={{ color: T.paperDim, fontSize: 12.5, fontFamily: FONT, textAlign: "center" }}>{owner.bio}</div>}
          <div style={{ display: "flex", gap: 26, marginTop: 4 }}>
            <div style={{ textAlign: "center" }}><div style={{ color: T.paper, fontWeight: 700, fontFamily: FONT, fontSize: 15 }}>{abbreviate(owner.following_count || 0)}</div><div style={{ color: T.paperDim, fontSize: 11.5, fontFamily: FONT }}>Following</div></div>
            <div style={{ textAlign: "center" }}><div style={{ color: T.paper, fontWeight: 700, fontFamily: FONT, fontSize: 15 }}>{abbreviate(owner.followers_count || 0)}</div><div style={{ color: T.paperDim, fontSize: 11.5, fontFamily: FONT }}>Followers</div></div>
            <div style={{ textAlign: "center" }}><div style={{ color: T.paper, fontWeight: 700, fontFamily: FONT, fontSize: 15 }}>{abbreviate(owner.likes_count || 0)}</div><div style={{ color: T.paperDim, fontSize: 11.5, fontFamily: FONT }}>Likes</div></div>
          </div>
          {!isOwnProfile && (
            <button onClick={onFollow} disabled={followBusy} style={{ marginTop: 6, background: isFollowing ? "transparent" : T.lime, color: isFollowing ? T.paper : T.bg, border: isFollowing ? `1px solid ${T.paperDim}` : "none", borderRadius: 18, padding: "8px 24px", fontFamily: FONT, fontWeight: 700, fontSize: 13, cursor: "pointer", opacity: followBusy ? 0.6 : 1 }}>
              {isFollowing ? "Following" : "Follow"}
            </button>
          )}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, padding: "0 16px 16px" }}>
          {theirVideos.length === 0 && (
            <div style={{ gridColumn: "1 / -1", textAlign: "center", color: T.paperDim, fontFamily: FONT, fontSize: 13, padding: "20px 0" }}>No reels from @{owner.username} in the current feed yet</div>
          )}
          {theirVideos.map((v) => (
            <div key={v.id} style={{ aspectRatio: "9/13", borderRadius: 8, background: "linear-gradient(160deg,#2d3b1f,#141310 70%)", position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", left: 6, bottom: 6, right: 6, color: T.paper, fontSize: 11, fontFamily: FONT }}>{v.caption?.slice(0, 30)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Feed screen — one swipe moves exactly one reel (scrollSnapStop: always on
// every slide, set above, is what prevents a fast swipe skipping several).
// ---------------------------------------------------------------------------
function FeedScreen({ api, myUserId, onOpenProfile }) {
  const [videos, setVideos] = useState([]);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [likeBusy, setLikeBusy] = useState({});
  const [followBusy, setFollowBusy] = useState({});
  const [commentsFor, setCommentsFor] = useState(null);
  const [shareToast, setShareToast] = useState("");
  const [isMuted, setIsMuted] = useState(true); // persists across reels once unmuted
  const scrollerRef = useRef(null);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const data = await api.getFeed(0, 30);
      setVideos(data || []);
      setStatus(data && data.length ? "ready" : "empty");
    } catch (e) { setError(e.message); setStatus("error"); }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const toggleLike = async (video) => {
    setLikeBusy((s) => ({ ...s, [video.id]: true }));
    const wasLiked = video.is_liked;
    setVideos((vs) => vs.map((v) => v.id === video.id ? { ...v, is_liked: !wasLiked, likes_count: v.likes_count + (wasLiked ? -1 : 1) } : v));
    try { await (wasLiked ? api.unlike(video.id) : api.like(video.id)); }
    catch (e) { setVideos((vs) => vs.map((v) => v.id === video.id ? { ...v, is_liked: wasLiked, likes_count: video.likes_count } : v)); }
    finally { setLikeBusy((s) => ({ ...s, [video.id]: false })); }
  };

  const toggleFollow = async (video) => {
    const username = video.owner.username;
    setFollowBusy((s) => ({ ...s, [username]: true }));
    const wasFollowing = video.owner.is_following;
    setVideos((vs) => vs.map((v) => v.owner.username === username ? { ...v, owner: { ...v.owner, is_following: !wasFollowing } } : v));
    try { await (wasFollowing ? api.unfollow(username) : api.follow(username)); }
    catch (e) { setVideos((vs) => vs.map((v) => v.owner.username === username ? { ...v, owner: { ...v.owner, is_following: wasFollowing } } : v)); }
    finally { setFollowBusy((s) => ({ ...s, [username]: false })); }
  };

  const shareVideo = async (video) => {
    const url = `${window.location.origin}${window.location.pathname}#video-${video.id}`;
    try {
      if (navigator.share) await navigator.share({ title: "GrowTok", text: `Check out @${video.owner.username} on GrowTok`, url });
      else { await navigator.clipboard.writeText(url); setShareToast("Link copied"); setTimeout(() => setShareToast(""), 1800); }
      setVideos((vs) => vs.map((v) => v.id === video.id ? { ...v, shares_count: v.shares_count + 1 } : v));
    } catch (_) {}
  };

  const bumpCommentCount = (videoId, delta) => setVideos((vs) => vs.map((v) => v.id === videoId ? { ...v, comments_count: v.comments_count + delta } : v));

  const items = withAds(videos);
  const skipAd = (index) => {
    const el = scrollerRef.current;
    if (!el) return;
    const next = el.children[index + 1];
    if (next) next.scrollIntoView({ behavior: "smooth" });
  };

  if (status === "loading") return <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: T.paperDim, fontFamily: FONT }}>Loading feed…</div>;
  if (status === "error") return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 24px", textAlign: "center", gap: 10 }}>
      <span style={{ color: T.danger, fontFamily: FONT, fontSize: 13.5 }}>{error}</span>
      <button onClick={load} style={{ background: T.lime, color: T.bg, border: "none", borderRadius: 16, padding: "8px 18px", fontFamily: FONT, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Retry</button>
    </div>
  );
  if (status === "empty") return <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: T.paperDim, fontFamily: FONT, textAlign: "center", padding: "0 30px" }}>No videos yet — upload the first one!</div>;

  return (
    <div style={{ position: "relative", height: "100%" }}>
      <div ref={scrollerRef} style={{ height: "100%", overflowY: "scroll", scrollSnapType: "y mandatory" }}>
        {items.map((item, i) =>
          item.kind === "ad" ? (
            ADSENSE_READY ? <AdSenseSlide key={item.id} /> : <AdSlide key={item.id} ad={item} onSkip={() => skipAd(i)} />
          ) : (
            <FeedSlide
              key={item.id}
              video={item}
              liked={item.is_liked}
              likeBusy={!!likeBusy[item.id]}
              isFollowing={item.owner.is_following}
              followBusy={!!followBusy[item.owner.username]}
              showFollow={!item.is_owner}
              isMuted={isMuted}
              onToggleSound={() => setIsMuted((m) => !m)}
              onLike={() => toggleLike(item)}
              onComment={() => setCommentsFor(item)}
              onFollow={() => toggleFollow(item)}
              onShare={() => shareVideo(item)}
              onOpenProfile={(owner) => onOpenProfile(owner, videos)}
            />
          )
        )}
      </div>
      <div style={{ position: "absolute", top: 16, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 22, zIndex: 5 }}>
        <span style={{ color: T.paper, fontSize: 14, fontWeight: 700, borderBottom: `2px solid ${T.lime}`, paddingBottom: 3, fontFamily: FONT }}>For You</span>
      </div>
      {shareToast && <div style={{ position: "absolute", top: 56, left: "50%", transform: "translateX(-50%)", background: T.card, border: `1px solid ${T.line}`, borderRadius: 14, padding: "6px 14px", color: T.paper, fontSize: 12.5, fontFamily: FONT, zIndex: 6 }}>{shareToast}</div>}
      {commentsFor && <CommentsDrawer video={commentsFor} api={api} myUserId={myUserId} onClose={() => setCommentsFor(null)} onCountChange={(delta) => bumpCommentCount(commentsFor.id, delta)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Upload screen — now with a sound name field
// ---------------------------------------------------------------------------
function UploadScreen({ api, onUploaded }) {
  const [files, setFiles] = useState([]);
  const [caption, setCaption] = useState("");
  const [soundName, setSoundName] = useState("Original sound");
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const inputRef = useRef(null);

  const onPick = (e) => { setFiles(Array.from(e.target.files || [])); setStatus("idle"); };

  const onUpload = async () => {
    if (!files.length) return;
    setStatus("uploading"); setError("");
    try {
      const chunks = [];
      for (let i = 0; i < files.length; i += 10) chunks.push(files.slice(i, i + 10));
      setProgress({ done: 0, total: files.length });
      const failures = [];
      for (const chunk of chunks) {
        const videos = await Promise.all(chunk.map(async (f) => ({
          caption: caption || "",
          sound_name: soundName || "Original sound",
          video_base64: await fileToBase64(f),
        })));
        const res = await api.uploadBatch(videos);
        if (res.failed?.length) failures.push(...res.failed);
        setProgress((p) => ({ ...p, done: p.done + chunk.length }));
      }
      if (failures.length) setError(`${failures.length} clip(s) failed to upload`);
      setStatus("done"); setFiles([]); setCaption(""); setSoundName("Original sound");
      onUploaded?.();
    } catch (e) { setError(e.message || "Upload failed"); setStatus("error"); }
  };

  const inputStyle = { width: "100%", boxSizing: "border-box", background: T.card, border: `1px solid ${T.line}`, borderRadius: 12, padding: "10px 14px", color: T.paper, fontFamily: FONT, fontSize: 13.5, outline: "none", marginBottom: 12 };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 28px 70px", boxSizing: "border-box", textAlign: "center" }}>
      <Sprout size={40} color={T.lime} />
      <h2 style={{ color: T.paper, fontFamily: FONT, fontSize: 19, fontWeight: 700, margin: "16px 0 6px" }}>Plant something new</h2>
      <p style={{ color: T.paperDim, fontFamily: FONT, fontSize: 13.5, lineHeight: 1.5, margin: "0 0 16px" }}>Select multiple videos to post them all at once.</p>
      <input ref={inputRef} type="file" accept="video/*" multiple onChange={onPick} style={{ display: "none" }} />
      {files.length === 0 ? (
        <button onClick={() => inputRef.current?.click()} style={{ background: T.lime, color: T.bg, border: "none", borderRadius: 24, padding: "12px 28px", fontFamily: FONT, fontWeight: 700, fontSize: 14.5, cursor: "pointer" }}>Choose videos</button>
      ) : (
        <>
          <input placeholder="Caption for this batch (optional)" value={caption} onChange={(e) => setCaption(e.target.value)} style={inputStyle} />
          <input
            placeholder="Sound name (e.g., Trending Beat, Lo-Fi)"
            value={soundName}
            onChange={(e) => setSoundName(e.target.value)}
            style={inputStyle}
          />
          <div style={{ width: "100%", maxHeight: 140, overflowY: "auto", border: `1px solid ${T.line}`, borderRadius: 12, marginBottom: 14, textAlign: "left" }}>
            {files.map((f, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "9px 12px", borderBottom: i < files.length - 1 ? `1px solid ${T.line}` : "none" }}>
                <span style={{ color: T.paper, fontSize: 12.5, fontFamily: FONT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>{f.name}</span>
                <span style={{ color: T.paperDim, fontSize: 11.5, fontFamily: FONT }}>{(f.size / (1024 * 1024)).toFixed(1)} MB</span>
              </div>
            ))}
          </div>
          {status === "uploading" && <div style={{ color: T.paperDim, fontSize: 12.5, fontFamily: FONT, marginBottom: 10 }}>Uploading {progress.done}/{progress.total}…</div>}
          {error && <div style={{ color: T.danger, fontSize: 12.5, fontFamily: FONT, marginBottom: 10 }}>{error}</div>}
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => inputRef.current?.click()} disabled={status === "uploading"} style={{ background: "none", border: `1px solid ${T.line}`, color: T.paper, borderRadius: 22, padding: "10px 18px", fontFamily: FONT, fontWeight: 600, fontSize: 13.5, cursor: "pointer" }}>Change</button>
            <button onClick={onUpload} disabled={status === "uploading"} style={{ background: T.lime, color: T.bg, border: "none", borderRadius: 22, padding: "10px 22px", fontFamily: FONT, fontWeight: 700, fontSize: 13.5, cursor: "pointer", opacity: status === "uploading" ? 0.7 : 1 }}>
              {status === "uploading" ? "Posting…" : status === "done" ? "Posted ✓" : `Post ${files.length} video${files.length > 1 ? "s" : ""}`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Profile screen — edit bio + photo, view your own reels grid.
// Username changes aren't supported (the backend has no endpoint for it).
// ---------------------------------------------------------------------------
function ProfileScreen({ me, api, onLogout, onProfileUpdated }) {
  const [editing, setEditing] = useState(false);
  const [bio, setBio] = useState(me?.bio || "");
  const [avatarPreview, setAvatarPreview] = useState(me?.avatar_base64 || null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const fileRef = useRef(null);

  const [myVideos, setMyVideos] = useState([]);
  const [videosStatus, setVideosStatus] = useState("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.getMyVideos();
        if (!cancelled) { setMyVideos(data || []); setVideosStatus("ready"); }
      } catch (e) { if (!cancelled) setVideosStatus("error"); }
    })();
    return () => { cancelled = true; };
  }, [api]);

  if (!me) return null;

  const startEdit = () => { setBio(me.bio || ""); setAvatarPreview(me.avatar_base64 || null); setSaveError(""); setEditing(true); };

  const onPickAvatar = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const b64 = await fileToBase64(file);
    setAvatarPreview(b64);
  };

  const save = async () => {
    setSaving(true); setSaveError("");
    try {
      const payload = { bio };
      if (avatarPreview && avatarPreview !== me.avatar_base64) payload.avatar_base64 = avatarPreview;
      const updated = await api.updateMe(payload);
      onProfileUpdated(updated);
      setEditing(false);
    } catch (e) { setSaveError(e.message || "Couldn't save"); } finally { setSaving(false); }
  };

  const stats = [
    { label: "Following", value: abbreviate(me.following_count) },
    { label: "Followers", value: abbreviate(me.followers_count) },
    { label: "Likes", value: abbreviate(me.likes_count) },
  ];

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "28px 20px 70px", boxSizing: "border-box" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
        <div style={{ position: "relative" }}>
          <Avatar user={{ username: me.username, avatar_base64: editing ? avatarPreview : me.avatar_base64 }} size={76} />
          {editing && (
            <button onClick={() => fileRef.current?.click()} style={{ position: "absolute", bottom: -2, right: -2, background: T.lime, border: `2px solid ${T.bg}`, borderRadius: "50%", width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              <Pencil size={12} color={T.bg} />
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/*" onChange={onPickAvatar} style={{ display: "none" }} />
        </div>

        <div style={{ color: T.paper, fontWeight: 700, fontFamily: FONT, fontSize: 16 }}>@{me.username}</div>

        {editing ? (
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="Add a bio"
            maxLength={150}
            rows={2}
            style={{ width: "100%", boxSizing: "border-box", background: T.card, border: `1px solid ${T.line}`, borderRadius: 12, padding: "10px 14px", color: T.paper, fontFamily: FONT, fontSize: 13, outline: "none", resize: "none" }}
          />
        ) : (
          me.bio && <div style={{ color: T.paperDim, fontSize: 12.5, fontFamily: FONT, textAlign: "center" }}>{me.bio}</div>
        )}

        <div style={{ display: "flex", gap: 26, marginTop: 8 }}>
          {stats.map((s) => (
            <div key={s.label} style={{ textAlign: "center" }}>
              <div style={{ color: T.paper, fontWeight: 700, fontFamily: FONT, fontSize: 15 }}>{s.value}</div>
              <div style={{ color: T.paperDim, fontSize: 11.5, fontFamily: FONT }}>{s.label}</div>
            </div>
          ))}
        </div>

        {editing ? (
          <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
            <button onClick={() => setEditing(false)} disabled={saving} style={{ background: "none", border: `1px solid ${T.line}`, color: T.paper, borderRadius: 18, padding: "8px 20px", fontFamily: FONT, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>Cancel</button>
            <button onClick={save} disabled={saving} style={{ background: T.lime, color: T.bg, border: "none", borderRadius: 18, padding: "8px 20px", fontFamily: FONT, fontWeight: 700, fontSize: 13, cursor: "pointer", opacity: saving ? 0.7 : 1, display: "flex", alignItems: "center", gap: 6 }}>
              <Check size={14} /> {saving ? "Saving…" : "Save"}
            </button>
          </div>
        ) : (
          <button onClick={startEdit} style={{ marginTop: 10, background: "none", border: `1px solid ${T.line}`, color: T.paper, borderRadius: 18, padding: "8px 22px", fontFamily: FONT, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>Edit profile</button>
        )}
        {saveError && <div style={{ color: T.danger, fontSize: 12, fontFamily: FONT }}>{saveError}</div>}

        <button onClick={onLogout} style={{ marginTop: 4, background: "none", border: "none", color: T.paperDim, fontFamily: FONT, fontSize: 12.5, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
          <LogOut size={13} /> Log out
        </button>
      </div>

      <div style={{ marginTop: 24 }}>
        <div style={{ color: T.paperDim, fontFamily: FONT, fontSize: 12, fontWeight: 700, letterSpacing: 0.5, marginBottom: 10 }}>YOUR REELS</div>
        {videosStatus === "loading" && <div style={{ color: T.paperDim, fontFamily: FONT, fontSize: 13, textAlign: "center", padding: "16px 0" }}>Loading…</div>}
        {videosStatus === "error" && <div style={{ color: T.danger, fontFamily: FONT, fontSize: 13, textAlign: "center", padding: "16px 0" }}>Couldn't load your reels</div>}
        {videosStatus === "ready" && myVideos.length === 0 && (
          <div style={{ color: T.paperDim, fontFamily: FONT, fontSize: 13, textAlign: "center", padding: "16px 0" }}>You haven't posted any reels yet</div>
        )}
        {videosStatus === "ready" && myVideos.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
            {myVideos.map((v) => (
              <div key={v.id} style={{ aspectRatio: "9/13", borderRadius: 8, background: "linear-gradient(160deg,#2d3b1f,#141310 70%)", position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", left: 6, bottom: 6, right: 6, color: T.paper, fontSize: 11, fontFamily: FONT }}>{v.caption?.slice(0, 30)}</div>
                <div style={{ position: "absolute", top: 6, right: 6, color: T.paper, fontSize: 10, fontFamily: FONT, display: "flex", alignItems: "center", gap: 3 }}>
                  <Heart size={10} fill={T.coral} stroke="none" /> {abbreviate(v.likes_count)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <AdSenseBanner style={{ marginTop: 24 }} />
    </div>
  );
}

function BottomNav({ tab, setTab }) {
  const items = [
    { key: "feed", label: "Feed", icon: Home },
    { key: "discover", label: "Discover", icon: Compass },
    { key: "upload", label: null, icon: Plus },
    { key: "inbox", label: "Inbox", icon: MessageCircle },
    { key: "profile", label: "Profile", icon: User },
  ];
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 58, background: "rgba(20,19,16,0.92)", backdropFilter: "blur(6px)", borderTop: `1px solid ${T.line}`, display: "flex", alignItems: "center", zIndex: 20 }}>
      {items.map(({ key, label, icon: Icon }) =>
        key === "upload" ? (
          <button key={key} onClick={() => setTab(key)} style={{ flex: 1, display: "flex", justifyContent: "center", background: "none", border: "none", cursor: "pointer" }} aria-label="Upload">
            <div style={{ width: 40, height: 28, borderRadius: 8, background: T.lime, display: "flex", alignItems: "center", justifyContent: "center" }}><Icon size={18} color={T.bg} strokeWidth={2.5} /></div>
          </button>
        ) : (
          <button key={key} onClick={() => setTab(key)} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, background: "none", border: "none", cursor: "pointer" }}>
            <Icon size={21} color={tab === key ? T.lime : T.paperDim} strokeWidth={tab === key ? 2.4 : 2} />
            <span style={{ fontSize: 10.5, color: tab === key ? T.lime : T.paperDim, fontFamily: FONT, fontWeight: 600 }}>{label}</span>
          </button>
        )
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Discover screen — real, live-filtering search over the loaded feed.
// ---------------------------------------------------------------------------
function DiscoverScreen({ api, onOpenProfile }) {
  const [query, setQuery] = useState("");
  const [videos, setVideos] = useState([]);
  const [status, setStatus] = useState("loading");
  const tags = ["#growinpublic", "#buildinpublic", "#plantcheck", "#codelife", "#dayinmylife", "#booktok"];

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try { const data = await api.getFeed(0, 50); if (!cancelled) { setVideos(data || []); setStatus("ready"); } }
      catch (e) { if (!cancelled) setStatus("error"); }
    })();
    return () => { cancelled = true; };
  }, [api]);

  const q = query.trim().toLowerCase();
  const results = q ? videos.filter((v) => v.caption?.toLowerCase().includes(q) || v.owner?.username?.toLowerCase().includes(q)) : videos;

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "18px 16px 70px", boxSizing: "border-box" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, background: T.card, border: `1px solid ${T.line}`, borderRadius: 20, padding: "10px 14px", marginBottom: 18 }}>
        <Search size={16} color={T.paperDim} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search captions or @username" style={{ flex: 1, background: "none", border: "none", outline: "none", color: T.paper, fontFamily: FONT, fontSize: 14 }} />
        {query && <button onClick={() => setQuery("")} style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}><X size={15} color={T.paperDim} /></button>}
      </div>

      {!q && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
          {tags.map((t) => (
            <button key={t} onClick={() => setQuery(t.replace("#", ""))} style={{ background: T.card, border: `1px solid ${T.line}`, color: T.lime, borderRadius: 14, padding: "6px 12px", fontSize: 13, fontFamily: FONT, fontWeight: 600, cursor: "pointer" }}>{t}</button>
          ))}
        </div>
      )}

      <AdSenseBanner style={{ marginBottom: 18 }} />

      {status === "loading" && <div style={{ color: T.paperDim, fontFamily: FONT, fontSize: 13, textAlign: "center", padding: "20px 0" }}>Loading…</div>}
      {status === "error" && <div style={{ color: T.danger, fontFamily: FONT, fontSize: 13, textAlign: "center", padding: "20px 0" }}>Couldn't load videos</div>}
      {status === "ready" && (
        q && results.length === 0 ? (
          <div style={{ color: T.paperDim, fontFamily: FONT, fontSize: 13, textAlign: "center", padding: "20px 0" }}>No results for "{query}"</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {results.map((v) => (
              <button key={v.id} onClick={() => onOpenProfile(v.owner, videos)} style={{ aspectRatio: "9/13", borderRadius: 12, background: "linear-gradient(160deg,#2d3b1f,#141310 70%)", border: "none", padding: 0, cursor: "pointer", position: "relative", overflow: "hidden", textAlign: "left" }}>
                <div style={{ position: "absolute", left: 8, bottom: 8, right: 8, color: T.paper, fontSize: 12, fontFamily: FONT }}>
                  <div style={{ fontWeight: 700, marginBottom: 2 }}>@{v.owner?.username}</div>
                  <div>{v.caption?.slice(0, 40)}{v.caption?.length > 40 ? "…" : ""}</div>
                </div>
              </button>
            ))}
          </div>
        )
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------
export default function GrowTokApp() {
  const [tokens, setTokens] = useState(null);
  const [tab, setTab] = useState("feed");
  const [feedKey, setFeedKey] = useState(0);
  const [viewingProfile, setViewingProfile] = useState(null);

  const api = useApi(tokens, setTokens);

  if (!tokens) return <Shell><ConnectScreen onAuthed={setTokens} /></Shell>;

  const openProfile = (owner, videos) => setViewingProfile({ owner, videos });
  const closeProfile = () => setViewingProfile(null);
  const profileFollowing = viewingProfile?.videos.find((v) => v.owner.username === viewingProfile.owner.username)?.owner.is_following;

  return (
    <Shell>
      <div style={{ position: "absolute", inset: 0 }}>
        {tab === "feed" && <FeedScreen key={feedKey} api={api} myUserId={tokens.user?.id} onOpenProfile={openProfile} />}
        {tab === "discover" && <DiscoverScreen api={api} onOpenProfile={openProfile} />}
        {tab === "upload" && <UploadScreen api={api} onUploaded={() => { setFeedKey((k) => k + 1); setTab("feed"); }} />}
        {tab === "inbox" && <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: T.paperDim, fontFamily: FONT }}>No messages yet</div>}
        {tab === "profile" && (
          <ProfileScreen
            me={tokens.user}
            api={api}
            onLogout={() => setTokens(null)}
            onProfileUpdated={(updated) => setTokens((t) => ({ ...t, user: { ...t.user, ...updated } }))}
          />
        )}
      </div>
      {!viewingProfile && <BottomNav tab={tab} setTab={setTab} />}

      {viewingProfile && (
        <div style={{ position: "absolute", inset: 0, zIndex: 30 }}>
          <CreatorProfileScreen
            owner={viewingProfile.owner}
            videos={viewingProfile.videos}
            isOwnProfile={viewingProfile.owner.username === tokens.user?.username}
            isFollowing={profileFollowing}
            followBusy={false}
            onFollow={async () => {
              try {
                if (profileFollowing) await api.unfollow(viewingProfile.owner.username);
                else await api.follow(viewingProfile.owner.username);
                setViewingProfile((p) => ({ ...p, videos: p.videos.map((v) => v.owner.username === p.owner.username ? { ...v, owner: { ...v.owner, is_following: !profileFollowing } } : v) }));
              } catch (_) {}
            }}
            onBack={closeProfile}
          />
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div style={{ display: "flex", justifyContent: "center", background: "#0a0a08", minHeight: "100vh", padding: "20px 0", fontFamily: FONT }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700&display=swap');`}</style>
      <div style={{ width: 390, height: 780, background: T.bg, borderRadius: 34, position: "relative", overflow: "hidden", boxShadow: "0 30px 60px rgba(0,0,0,0.5)", border: "8px solid #050504" }}>
        {children}
      </div>
    </div>
  );
}
