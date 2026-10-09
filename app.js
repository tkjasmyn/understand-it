const API_URL = "https://understand-it.onrender.com";

const state = {
  screen: "home",
  concept: "",
  confidence: 50,
  explanation: "",
  challenge: null, // { type, prompt, content, expected }
  prediction: "",
  analysis: null,
  history: [],
  loading: false,
  error: null,
  errorReturn: "explain", // where "Try Again" should send the user
};

const app = document.getElementById("app");

/* ---------- Helpers ---------- */

function renderMarkdown(text) {
  if (!text) return "";
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  html = html.replace(/^### (.*$)/gim, "<h3>$1</h3>");
  html = html.replace(/^## (.*$)/gim, "<h2>$1</h2>");
  html = html.replace(/^# (.*$)/gim, "<h2>$1</h2>");

  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  html = html.replace(/^\s*[-*] (.*$)/gim, "<li>$1</li>");
  html = html.replace(/(<li>.*<\/li>)/s, "<ul>$1</ul>");

  html = html
    .split("\n\n")
    .map((p) => {
      const trimmed = p.trim();
      if (!trimmed) return "";
      if (
        trimmed.startsWith("<h") ||
        trimmed.startsWith("<ul") ||
        trimmed.startsWith("<li")
      ) {
        return trimmed;
      }
      return `<p>${trimmed.replace(/\n/g, "<br>")}</p>`;
    })
    .join("");

  return html;
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function stepsBar(current) {
  const steps = ["Concept", "Confidence", "Explain", "Challenge", "Analysis"];
  return `
    <div class="steps">
      ${steps
        .map((s, i) => {
          const idx = i + 1;
          let cls = "step";
          if (idx === current) cls += " active";
          else if (idx < current) cls += " done";
          return `<span class="${cls}">${s}</span>`;
        })
        .join("")}
    </div>
  `;
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/* ---------- Screens ---------- */

function renderHome() {
  app.innerHTML = `
    <div class="card">
      <h1>Don't just recognize it. Prove you understand it.</h1>
      <p>
        Most studying tests whether you can <em>recognize</em> an answer.
        Understand It tests whether you can <strong>explain a concept</strong>
        and <strong>apply it to something you haven't seen before</strong> — then
        an AI shows you exactly where your mental model breaks.
      </p>
      <p>
        Any subject. Any concept. From Newton's laws to photosynthesis to
        Python dictionaries.
      </p>
      <h2>What did you study today?</h2>
      <input
        type="text"
        id="conceptInput"
        placeholder="e.g. Newton's third law, photosynthesis, supply and demand..."
      />
      <button class="primary" id="startButton">Test My Understanding →</button>
    </div>
  `;

  const input = document.getElementById("conceptInput");
  const btn = document.getElementById("startButton");

  btn.addEventListener("click", () => {
    const concept = input.value.trim();
    if (!concept) {
      alert("Enter something you learned first.");
      return;
    }
    state.concept = concept;
    state.screen = "confidence";
    render();
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") btn.click();
  });
}

function renderConfidence() {
  app.innerHTML = `
    <div class="card">
      ${stepsBar(2)}
      <h1>How confident are you?</h1>
      <p>
        You said you understand: <strong>${escapeHtml(state.concept)}</strong>
      </p>
      <p>
        Be honest. This isn't a test of ego — it's a calibration exercise.
        Overconfidence is itself a finding.
      </p>
      <input
        type="range"
        id="confidenceInput"
        min="0"
        max="100"
        value="${state.confidence}"
      />
      <p style="text-align:center; font-size:1.5rem; color:var(--accent); font-weight:700;">
        <span id="confidenceValue">${state.confidence}</span>%
      </p>
      <button class="primary" id="continueButton">Continue →</button>
    </div>
  `;

  const slider = document.getElementById("confidenceInput");
  const label = document.getElementById("confidenceValue");

  slider.addEventListener("input", () => {
    label.textContent = slider.value;
  });

  document.getElementById("continueButton").addEventListener("click", () => {
    state.confidence = Number(slider.value);
    state.screen = "explain";
    render();
  });
}

function renderExplain() {
  app.innerHTML = `
    <div class="card">
      ${stepsBar(3)}
      <h1>Explain it from memory</h1>
      <p>
        Teach <strong>${escapeHtml(state.concept)}</strong> to someone who has
        never learned it before. Use your own words. Don't look anything up.
      </p>
      <textarea
        id="answerInput"
        placeholder="Explain it in your own words..."
      >${escapeHtml(state.explanation)}</textarea>
      <button class="primary" id="submitAnswer">Continue →</button>
    </div>
  `;

  const textarea = document.getElementById("answerInput");
  document.getElementById("submitAnswer").addEventListener("click", () => {
    const answer = textarea.value.trim();
    if (!answer) {
      alert("Explain the concept before continuing.");
      return;
    }
    state.explanation = answer;
    generateChallenge();
  });
}

function renderGeneratingChallenge() {
  app.innerHTML = `
    <div class="card">
      ${stepsBar(4)}
      <div class="loading">
        <div class="spinner"></div>
        <h1>Designing your challenge...</h1>
        <p>
          The AI is crafting a situation that will reveal whether you truly
          understand <strong>${escapeHtml(state.concept)}</strong>.
        </p>
      </div>
    </div>
  `;
}

function renderPredict() {
  const c = state.challenge;
  if (!c) {
    // Defensive — shouldn't happen, but recover gracefully
    state.screen = "error";
    state.error = "No challenge was generated. Please try again.";
    state.errorReturn = "explain";
    render();
    return;
  }

  const isCode = c.type === "code";

  const contentBlock = isCode
    ? `<pre>${escapeHtml(c.content)}</pre>`
    : `<div class="scenario">${escapeHtml(c.content)}</div>`;

  app.innerHTML = `
    <div class="card">
      ${stepsBar(4)}
      <h1>${escapeHtml(c.prompt || "What happens, and why?")}</h1>
      <p>
        Concept: <strong>${escapeHtml(state.concept)}</strong>
      </p>
      <p>
        Don't run this or look it up. Reason it through, then explain the
        mechanism — not just the outcome.
      </p>

      ${contentBlock}

      <textarea
        id="predictionInput"
        placeholder="What happens, and why? Be specific about the mechanism."
      >${escapeHtml(state.prediction)}</textarea>

      <button class="primary" id="submitPrediction">
        Submit for AI Analysis →
      </button>
    </div>
  `;

  const textarea = document.getElementById("predictionInput");
  document.getElementById("submitPrediction").addEventListener("click", () => {
    const prediction = textarea.value.trim();
    if (!prediction) {
      alert("Make a prediction before continuing.");
      return;
    }
    state.prediction = prediction;
    submitToBackend();
  });
}

function renderAnalyzing() {
  app.innerHTML = `
    <div class="card">
      ${stepsBar(5)}
      <div class="loading">
        <div class="spinner"></div>
        <h1>Analyzing your understanding...</h1>
        <p>
          Comparing what you believed to what you actually produced.
        </p>
      </div>
    </div>
  `;
}

function renderError() {
  app.innerHTML = `
    <div class="card">
      ${stepsBar(5)}
      <h1>Something went wrong</h1>
      <div class="error-box">
        <strong>Error:</strong> ${escapeHtml(state.error || "Unknown error")}
      </div>
      <p>
        Make sure the Go backend is running on port 8080 and that the
        <code>GROQ_API_KEY</code> environment variable is set.
      </p>
      <button class="secondary" id="retryBtn">Try Again</button>
    </div>
  `;

  document.getElementById("retryBtn").addEventListener("click", () => {
    state.error = null;
    if (state.errorReturn === "explain") {
      state.screen = "explain";
    } else {
      state.screen = "predict";
    }
    render();
  });
}

function renderAnalysis() {
  const a = state.analysis;
  const attempt = a.attempt;
  const challenge = attempt.challenge || {};

  const isCode = challenge.type === "code";
  const challengeBlock = isCode
    ? `<pre>${escapeHtml(challenge.content || "")}</pre>`
    : `<div class="scenario">${escapeHtml(challenge.content || "")}</div>`;

  app.innerHTML = `
    <div class="card">
      ${stepsBar(5)}
      <h1>Your Understanding Analysis</h1>
      <p>
        Concept: <strong>${escapeHtml(attempt.concept)}</strong> ·
        Self-reported confidence: <strong>${attempt.confidence}%</strong>
      </p>
    </div>

    <div class="card">
      <h2 style="margin-top:0;">What you were asked</h2>
      <p>${escapeHtml(challenge.prompt || "")}</p>
      ${challengeBlock}
    </div>

    <div class="analysis">
      ${renderMarkdown(a.analysis)}
    </div>

    <div style="margin-top:24px; display:flex; gap:12px; flex-wrap:wrap;">
      <button class="primary" id="againBtn">Test Another Concept</button>
      <button class="secondary" id="dashboardBtn">View Dashboard</button>
    </div>
  `;

  document.getElementById("againBtn").addEventListener("click", () => {
    state.screen = "home";
    state.concept = "";
    state.confidence = 50;
    state.explanation = "";
    state.challenge = null;
    state.prediction = "";
    state.analysis = null;
    state.error = null;
    render();
  });

  document.getElementById("dashboardBtn").addEventListener("click", () => {
    state.screen = "dashboard";
    loadHistory();
  });
}

function renderDashboard() {
  const history = state.history;

  if (state.loading) {
    app.innerHTML = `
      <div class="loading">
        <div class="spinner"></div>
        <p>Loading your history...</p>
      </div>
    `;
    return;
  }

  const total = history.length;
  const avgConfidence =
    total > 0
      ? Math.round(history.reduce((s, a) => s + a.confidence, 0) / total)
      : 0;

  app.innerHTML = `
    <h1>Your Dashboard</h1>
    <p>Every concept you've tested, with AI analysis of your mental models.</p>

    <div class="stat-grid">
      <div class="stat">
        <div class="stat-value">${total}</div>
        <div class="stat-label">Concepts Tested</div>
      </div>
      <div class="stat">
        <div class="stat-value">${avgConfidence}%</div>
        <div class="stat-label">Avg Confidence</div>
      </div>
    </div>

    ${
      total === 0
        ? `<div class="card"><p>No attempts yet. Take your first test to see it here.</p><button class="primary" id="startFromDash">Start Testing</button></div>`
        : history
            .slice()
            .reverse()
            .map((a) => {
              const challenge = a.challenge || {};
              const typeLabel =
                challenge.type === "code" ? "Code prediction" : "Scenario";
              return `
                <div class="attempt">
                  <div class="attempt-header">
                    <span class="attempt-concept">${escapeHtml(a.concept)}</span>
                    <span class="attempt-date">${formatDate(a.createdAt)}</span>
                  </div>
                  <div class="attempt-preview">
                    Confidence: ${a.confidence}% · ${typeLabel}
                  </div>
                  <details class="attempt-details">
                    <summary>View AI analysis</summary>
                    <div style="margin-top:12px;">
                      ${
                        challenge.content
                          ? challenge.type === "code"
                            ? `<pre>${escapeHtml(challenge.content)}</pre>`
                            : `<div class="scenario">${escapeHtml(
                                challenge.content,
                              )}</div>`
                          : ""
                      }
                      ${renderMarkdown(a.analysis)}
                    </div>
                  </details>
                </div>
              `;
            })
            .join("")
    }

    ${
      total > 0
        ? `<button class="secondary" id="clearBtn" style="margin-top:16px;">Clear History</button>`
        : ""
    }
  `;

  const startBtn = document.getElementById("startFromDash");
  if (startBtn) {
    startBtn.addEventListener("click", () => {
      state.screen = "home";
      render();
    });
  }

  const clearBtn = document.getElementById("clearBtn");
  if (clearBtn) {
    clearBtn.addEventListener("click", async () => {
      if (!confirm("Clear all history? This cannot be undone.")) return;
      await fetch(`${API_URL}/history`, { method: "DELETE" });
      state.history = [];
      renderDashboard();
    });
  }
}

/* ---------- Backend ---------- */

async function generateChallenge() {
  state.screen = "generating-challenge";
  render();

  try {
    const response = await fetch(`${API_URL}/challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        concept: state.concept,
        explanation: state.explanation,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(errText || `Server error: ${response.status}`);
    }

    const challenge = await response.json();
    state.challenge = challenge;
    state.screen = "predict";
    render();
  } catch (err) {
    console.error(err);
    state.error = err.message;
    state.errorReturn = "explain";
    state.screen = "error";
    render();
  }
}

async function submitToBackend() {
  state.screen = "analyzing";
  render();

  try {
    const response = await fetch(`${API_URL}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        concept: state.concept,
        confidence: state.confidence,
        explanation: state.explanation,
        prediction: state.prediction,
        challenge: state.challenge,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(errText || `Server error: ${response.status}`);
    }

    const data = await response.json();
    state.analysis = data;
    state.screen = "analysis";
    render();
  } catch (err) {
    console.error(err);
    state.error = err.message;
    state.errorReturn = "predict";
    state.screen = "error";
    render();
  }
}

async function loadHistory() {
  state.loading = true;
  renderDashboard();

  try {
    const response = await fetch(`${API_URL}/history`);
    if (!response.ok) throw new Error(`Server error: ${response.status}`);
    state.history = await response.json();
  } catch (err) {
    console.error(err);
    state.history = [];
  } finally {
    state.loading = false;
    renderDashboard();
  }
}

/* ---------- Router ---------- */

function render() {
  switch (state.screen) {
    case "home":
      renderHome();
      break;
    case "confidence":
      renderConfidence();
      break;
    case "explain":
      renderExplain();
      break;
    case "generating-challenge":
      renderGeneratingChallenge();
      break;
    case "predict":
      renderPredict();
      break;
    case "analyzing":
      renderAnalyzing();
      break;
    case "analysis":
      renderAnalysis();
      break;
    case "error":
      renderError();
      break;
    case "dashboard":
      renderDashboard();
      break;
    default:
      renderHome();
  }
}

/* ---------- Nav wiring ---------- */

document.getElementById("brandHome").addEventListener("click", () => {
  state.screen = "home";
  render();
});

document.getElementById("navHome").addEventListener("click", () => {
  state.screen = "home";
  render();
});

document.getElementById("navDashboard").addEventListener("click", () => {
  state.screen = "dashboard";
  loadHistory();
});

/* ---------- Go ---------- */

render();
