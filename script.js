// ============================================================
// CONFIGURACIÓN
// La API key está en Netlify (variables de entorno), no aquí.
// El frontend llama al proxy /api/chat para mayor seguridad.
// ============================================================
const GROQ_MODEL   = "llama-3.3-70b-versatile";
const PROXY_URL    = "/api/chat";

// ============================================================
// SYSTEM PROMPT — Personalidad y reglas del analista
// ============================================================
const SYSTEM_PROMPT = `Eres un Analista Senior de Opciones Financieras con más de 20 años de experiencia en mercados de derivados. Tu objetivo no es solo dar "señales", sino actuar como un mentor que enseña al usuario a pensar como un profesional. Tu enfoque principal es la supervivencia del capital y el crecimiento compuesto.

Tu tono es amable, informal y pedagógico. Imagina que eres un amigo experto que explica conceptos complejos de forma sencilla, pero que se pone muy serio y riguroso cuando se trata de la gestión del riesgo.

## Mandamientos del análisis

Cada vez que el usuario pregunte por un ticker o una estrategia, aplica este filtro técnico. NUNCA inventes datos de mercado. Si no tienes acceso a datos en tiempo real, pide al usuario:
- Precio actual del subyacente
- Volatilidad Implícita (IV) actual
- Fecha de expiración deseada
- Strikes que está considerando

## Parámetros obligatorios a analizar

- **Volatilidad Implícita (IV):** IV Rank e IV Percentile. ¿Está la prima cara o barata?
- **Delta (Δ):** Dirección y probabilidad de quedar In-The-Money.
- **Theta (Θ):** Impacto del paso del tiempo (time decay).
- **Vega:** Exposición a cambios en la volatilidad.
- **Liquidez:** Bid-Ask spread y Open Interest. Si es baja, advierte del riesgo de deslizamiento.
- **Contexto de riesgo:** Earnings próximos, datos del IPC, decisiones de la Fed.

## Guía de gestión de cuenta

- **Position Sizing:** Nunca sugieras arriesgar más del 2-5% de la cuenta en una sola operación.
- **Probabilidad de Éxito (POP):** Prioriza estrategias con alta POP explicando el trade-off riesgo/recompensa.
- **Ajustes:** Si una operación va mal, explica cómo ajustarla (roll, convertir en spread, reducir tamaño) antes de cerrar.

## Reglas de comportamiento

- Si no tienes un dato exacto, di: "Para darte un análisis exacto, pásame el precio actual y la cadena de opciones, no quiero darte números falsos."
- Explica siempre el PORQUÉ de cada estrategia: "Compramos este vertical porque la volatilidad está baja y esperamos un movimiento X..."
- Si el usuario propone vender naked calls/puts sin experiencia demostrada, DETÉN la conversación y explica los riesgos de pérdida ilimitada de forma didáctica.
- SIEMPRE añade al final un recordatorio de que el análisis es educativo y no constituye asesoramiento financiero.
- Si el usuario no ha indicado el tamaño de su cuenta, pregúntalo antes de sugerir tamaños de posición.

## Formato de respuesta para análisis de tickers o estrategias

Usa SIEMPRE este formato con estas secciones exactas:

## 📊 Análisis Rápido
(Resumen del ticker/situación actual)

## 🎯 El "Setup"
(Estrategia sugerida con sus porqués, strikes, expiración y prima estimada)

## 🛡️ Gestión del Riesgo
(Punto de salida, stop loss mental, plan de ajuste si va en contra)

## 💡 Lección del día
(Un breve tip educativo relacionado con la operación o concepto discutido)`;

// ============================================================
// ESTADO DE LA APLICACIÓN
// ============================================================
let conversationHistory = [];
let isLoading = false;

// ============================================================
// INICIALIZACIÓN
// ============================================================
marked.setOptions({ breaks: true, gfm: true });

window.addEventListener('DOMContentLoaded', () => {
    checkApiKey();
    setupTextarea();
});

function checkApiKey() {
    const dot  = document.getElementById('statusDot');
    const text = document.getElementById('statusText');
    dot.classList.add('online');
    text.textContent = 'Groq · Llama 3.3 70B · Online';
}

function setupTextarea() {
    const textarea = document.getElementById('userInput');

    textarea.addEventListener('input', () => {
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
    });

    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
}

// ============================================================
// MENSAJES
// ============================================================

// Escapa HTML para prevenir XSS en el input del usuario
function escapeHtml(text) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(text));
    return div.innerHTML;
}

function scrollToBottom() {
    const container = document.getElementById('chatContainer');
    container.scrollTop = container.scrollHeight;
}

function addSystemMessage(html) {
    const messages = document.getElementById('messages');
    const div = document.createElement('div');
    div.className = 'message assistant';
    div.innerHTML = `
        <div class="message-avatar">⚠️</div>
        <div class="message-content">${html}</div>
    `;
    messages.appendChild(div);
    scrollToBottom();
}

function addMessage(role, content, isStreaming = false) {
    const messages = document.getElementById('messages');
    const div = document.createElement('div');
    div.className = `message ${role}`;

    const avatar = role === 'user' ? 'TÚ' : '📊';
    let bodyHtml;

    if (isStreaming) {
        bodyHtml = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
    } else {
        bodyHtml = role === 'user'
            ? `<p>${escapeHtml(content)}</p>`
            : marked.parse(content);
    }

    div.innerHTML = `
        <div class="message-avatar">${avatar}</div>
        <div class="message-content">${bodyHtml}</div>
    `;

    messages.appendChild(div);
    scrollToBottom();
    return div;
}

// ============================================================
// ENVÍO Y STREAMING
// ============================================================
async function sendMessage() {
    if (isLoading) return;

    const input    = document.getElementById('userInput');
    const userText = input.value.trim();
    if (!userText) return;

    // Añadir mensaje del usuario
    addMessage('user', userText);
    conversationHistory.push({ role: 'user', content: userText });

    // Limpiar textarea
    input.value = '';
    input.style.height = 'auto';

    // Bloquear envío
    isLoading = true;
    document.getElementById('sendBtn').disabled = true;

    // Mostrar indicador de typing
    const msgDiv     = addMessage('assistant', '', true);
    const contentDiv = msgDiv.querySelector('.message-content');
    let fullResponse = '';

    try {
        const response = await fetch(PROXY_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: GROQ_MODEL,
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    ...conversationHistory
                ],
                temperature: 0.7,
                max_tokens: 2048,
                stream: true
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error?.message || `Error HTTP ${response.status}`);
        }

        // Leer stream token a token
        const reader  = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        contentDiv.innerHTML = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            for (const line of chunk.split('\n')) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('data: ') || trimmed === 'data: [DONE]') continue;

                try {
                    const parsed = JSON.parse(trimmed.slice(6));
                    const delta  = parsed.choices?.[0]?.delta?.content;
                    if (delta) {
                        fullResponse += delta;
                        contentDiv.innerHTML = marked.parse(fullResponse);
                        scrollToBottom();
                    }
                } catch {
                    // Ignorar líneas malformadas del stream
                }
            }
        }

        // Guardar respuesta completa en el historial
        conversationHistory.push({ role: 'assistant', content: fullResponse });

    } catch (err) {
        contentDiv.innerHTML = `
            <p style="color: var(--accent-red);">
                ❌ <strong>Error al conectar con Groq:</strong> ${escapeHtml(err.message)}
            </p>
            <p style="color: var(--text-secondary); font-size: 13px; margin-top: 6px;">
                Comprueba que tu API Key es correcta y que tienes conexión a internet.
            </p>
        `;
    } finally {
        isLoading = false;
        document.getElementById('sendBtn').disabled = false;
        input.focus();
    }
}
