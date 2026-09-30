package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/joho/godotenv"
)

const (
	groqAPIURL = "https://api.groq.com/openai/v1/chat/completions"
	groqModel  = "openai/gpt-oss-120b"
)

/* ---------- Request / Response Types ---------- */

type ChallengeRequest struct {
	Concept     string `json:"concept"`
	Explanation string `json:"explanation"`
}

type ChallengeResponse struct {
	Type     string `json:"type"`     // "code" or "scenario"
	Prompt   string `json:"prompt"`   // e.g. "What will this print?" or "What happens, and why?"
	Content  string `json:"content"`  // the code snippet OR the scenario text
	Expected string `json:"expected"` // the correct answer
}

type AnalysisRequest struct {
	Concept     string `json:"concept"`
	Confidence  int    `json:"confidence"`
	Explanation string `json:"explanation"`
	Prediction  string `json:"prediction"`
	Challenge   ChallengeResponse `json:"challenge"`
}

type Attempt struct {
	ID          string            `json:"id"`
	Concept     string            `json:"concept"`
	Confidence  int               `json:"confidence"`
	Explanation string            `json:"explanation"`
	Prediction  string            `json:"prediction"`
	Challenge   ChallengeResponse `json:"challenge"`
	Analysis    string            `json:"analysis"`
	CreatedAt   time.Time         `json:"createdAt"`
}

type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type ChatRequestBody struct {
	Model          string        `json:"model"`
	Messages       []ChatMessage `json:"messages"`
	Stream         bool          `json:"stream"`
	ResponseFormat *ResponseFmt  `json:"response_format,omitempty"`
	Temperature    float64       `json:"temperature,omitempty"`
}

type ResponseFmt struct {
	Type string `json:"type"`
}

type ChatResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
}

var (
	attempts   []Attempt
	attemptsMu sync.Mutex
)

/* ---------- Helpers ---------- */

func cors(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
}

func stripCodeFences(s string) string {
	s = strings.TrimSpace(s)
	s = strings.TrimPrefix(s, "```json")
	s = strings.TrimPrefix(s, "```")
	s = strings.TrimSuffix(s, "```")
	return strings.TrimSpace(s)
}

func callGroqRaw(systemPrompt, userPrompt string, jsonMode bool) (string, error) {
	apiKey := os.Getenv("GROQ_API_KEY")
	if apiKey == "" {
		return "", fmt.Errorf("GROQ_API_KEY not set in environment or .env file")
	}

	body := ChatRequestBody{
		Model: groqModel,
		Messages: []ChatMessage{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: userPrompt},
		},
		Stream:      false,
		Temperature: 0.7,
	}

	if jsonMode {
		body.ResponseFormat = &ResponseFmt{Type: "json_object"}
	}

	jsonBody, err := json.Marshal(body)
	if err != nil {
		return "", fmt.Errorf("marshal error: %w", err)
	}

	httpReq, err := http.NewRequest("POST", groqAPIURL, bytes.NewBuffer(jsonBody))
	if err != nil {
		return "", fmt.Errorf("request creation error: %w", err)
	}

	httpReq.Header.Set("Authorization", "Bearer "+apiKey)
	httpReq.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		return "", fmt.Errorf("API call failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("Groq returned %d: %s", resp.StatusCode, string(respBody))
	}

	var apiResp ChatResponse
	if err := json.Unmarshal(respBody, &apiResp); err != nil {
		return "", fmt.Errorf("unmarshal error: %w", err)
	}

	if len(apiResp.Choices) == 0 {
		return "", fmt.Errorf("no choices returned from Groq")
	}

	return apiResp.Choices[0].Message.Content, nil
}

/* ---------- Handlers ---------- */

func challengeHandler(w http.ResponseWriter, r *http.Request) {
	cors(w)

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req ChallengeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		log.Println("JSON decode error:", err)
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	if strings.TrimSpace(req.Concept) == "" {
		http.Error(w, "concept is required", http.StatusBadRequest)
		return
	}

	log.Printf("Challenge requested for concept=%q", req.Concept)

	challenge, err := generateChallenge(req)
	if err != nil {
		log.Println("Challenge generation error:", err)
		http.Error(w, "Challenge generation failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(challenge)
}

func analyzeHandler(w http.ResponseWriter, r *http.Request) {
	cors(w)

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req AnalysisRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		log.Println("JSON decode error:", err)
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	log.Printf("Analyzing: concept=%q confidence=%d", req.Concept, req.Confidence)

	analysis, err := analyzeUnderstanding(req)
	if err != nil {
		log.Println("Analysis error:", err)
		http.Error(w, "AI analysis failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	attempt := Attempt{
		ID:          fmt.Sprintf("%d", time.Now().UnixNano()),
		Concept:     req.Concept,
		Confidence:  req.Confidence,
		Explanation: req.Explanation,
		Prediction:  req.Prediction,
		Challenge:   req.Challenge,
		Analysis:    analysis,
		CreatedAt:   time.Now(),
	}

	attemptsMu.Lock()
	attempts = append(attempts, attempt)
	attemptsMu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"analysis": analysis,
		"attempt":  attempt,
	})
}

func historyHandler(w http.ResponseWriter, r *http.Request) {
	cors(w)

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method == http.MethodDelete {
		attemptsMu.Lock()
		attempts = []Attempt{}
		attemptsMu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "cleared"})
		return
	}

	attemptsMu.Lock()
	defer attemptsMu.Unlock()

	if attempts == nil {
		attempts = []Attempt{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(attempts)
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	cors(w)
	keyStatus := "missing"
	if os.Getenv("GROQ_API_KEY") != "" {
		keyStatus = "set"
	}
	fmt.Fprintf(w, "Understand It backend is running. GROQ_API_KEY: %s\n", keyStatus)
}

/* ---------- AI Calls ---------- */

func generateChallenge(req ChallengeRequest) (ChallengeResponse, error) {
	systemPrompt := `You design short prediction challenges for students who claim to understand a concept.

Your job: create ONE novel situation that reveals whether the student truly understands the concept — not just recognizes it.

Rules:
- If the concept is a programming / computer science concept, return a short code snippet (Python unless the concept clearly implies another language) and ask what it prints or what the state becomes.
- Otherwise, return a short real-world or theoretical scenario and ask what happens, or what the outcome is, and why.
- The challenge MUST be something the student has to reason about — not recall from memory. It should be a specific situation, not a definition question.
- It must be answerable in 2-4 sentences.
- It must be fair: the correct answer should be unambiguous to someone who truly understands the concept.
- Keep the content under 80 words.
- Do NOT explain the answer inside the content. Only pose the situation.
- Do NOT wrap the code in markdown fences inside the JSON.

Return ONLY valid JSON in this exact shape:
{
  "type": "code" or "scenario",
  "prompt": "short instruction, e.g. 'What will this print?' or 'What happens, and why?'",
  "content": "the code snippet or the scenario text, exactly as it should be shown to the student",
  "expected": "the correct answer, with a one-sentence justification"
}`

	userPrompt := fmt.Sprintf(`Student says they understand: %s

Their explanation of it so far:
%s

Create one prediction challenge for them.`, req.Concept, req.Explanation)

	raw, err := callGroqRaw(systemPrompt, userPrompt, true)
	if err != nil {
		return ChallengeResponse{}, err
	}

	clean := stripCodeFences(raw)

	var challenge ChallengeResponse
	if err := json.Unmarshal([]byte(clean), &challenge); err != nil {
		log.Printf("Failed to parse challenge JSON: %s", clean)
		return ChallengeResponse{}, fmt.Errorf("model returned invalid JSON: %w", err)
	}

	if challenge.Type == "" || challenge.Content == "" || challenge.Expected == "" {
		return ChallengeResponse{}, fmt.Errorf("model returned incomplete challenge")
	}

	return challenge, nil
}

func analyzeUnderstanding(req AnalysisRequest) (string, error) {
	systemPrompt := `You are an expert high school tutor analyzing whether a student truly understands a concept.

Your audience is a high school student (ages 13-18). Write as if talking to them directly, in second person ("you"). Be warm, clear, and concrete — never condescending.

Language rules:
- Short sentences. One idea per sentence.
- Avoid jargon. If a technical term is required, define it in parentheses immediately after, in 5 words or fewer.
- Prefer concrete images over abstract terms.
- Every sentence must add information. No padding.
- Assume the student is smart but has not yet learned the specific mechanism you are about to explain.

You will see:
- The concept they claim to understand
- Their self-reported confidence (0-100)
- Their explanation in their own words
- A prediction challenge they were given
- The expected correct answer
- Their actual answer

Your analysis must be honest, specific, and diagnostic. Compare what they believed (confidence) to what they actually produced.

Respond in markdown using exactly this structure:

## Verdict
One line: **Correct**, **Partially Correct**, or **Incorrect**. Then one sentence explaining the single biggest reason for this verdict.

## Did your confidence match?
One or two sentences, addressed directly to the student. Say plainly whether their confidence was earned, overconfident, or underconfident. This is the most useful part of the analysis — do not skip it.

## What you got right
1-2 sentences acknowledging the specific parts of their reasoning that were correct. If nothing was right, say so kindly and move on.

## Where it slipped
2-3 sentences identifying the exact misunderstanding. Quote or paraphrase their answer. If the reasoning was fully correct, say so and explain why it shows solid understanding.

## The big idea
2 sentences, no more. This is the clearest, simplest part of the whole analysis. Use a concrete image or everyday example if possible.

## Try this next
One concrete action. Not "study photosynthesis." Instead: a specific question they could ask themselves, or a small experiment they could run in their head.

Keep the entire response under 300 words. Be encouraging but never soften a real misunderstanding. If the student is wrong, say they are wrong — then explain kindly why.`

	userPrompt := fmt.Sprintf(`Concept: %s
Self-reported confidence: %d%%

Their explanation:
%s

The challenge they were given:
Type: %s
Prompt: %s
Content:
%s

Correct answer: %s

Their answer: %s

Analyze their understanding.`,
		req.Concept,
		req.Confidence,
		req.Explanation,
		req.Challenge.Type,
		req.Challenge.Prompt,
		req.Challenge.Content,
		req.Challenge.Expected,
		req.Prediction,
	)

	return callGroqRaw(systemPrompt, userPrompt, false)
}

/* ---------- Main ---------- */

func main() {
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found — relying on system environment variables")
	} else {
		log.Println(".env file loaded")
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	http.HandleFunc("/health", healthHandler)
	http.HandleFunc("/challenge", challengeHandler)
	http.HandleFunc("/analyze", analyzeHandler)
	http.HandleFunc("/history", historyHandler)

	log.Printf("Server running on http://localhost:%s", port)

	if os.Getenv("GROQ_API_KEY") == "" {
		log.Println("WARNING: GROQ_API_KEY is not set. AI calls will fail.")
	}

	log.Fatal(http.ListenAndServe(":"+port, nil))
}