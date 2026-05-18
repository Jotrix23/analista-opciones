// Netlify Edge Function — Proxy seguro hacia Groq API
// La API key vive en las variables de entorno de Netlify, nunca en el cliente.

export default async (request) => {
    // Solo aceptar POST
    if (request.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
    }

    const apiKey = Deno.env.get("GROQ_API_KEY");
    if (!apiKey) {
        return new Response(
            JSON.stringify({ error: { message: "GROQ_API_KEY no configurada en Netlify." } }),
            { status: 500, headers: { "Content-Type": "application/json" } }
        );
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return new Response(
            JSON.stringify({ error: { message: "Body inválido." } }),
            { status: 400, headers: { "Content-Type": "application/json" } }
        );
    }

    // Reenviar la petición a Groq con la key del servidor
    const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
    });

    // Pasar el stream de Groq directamente al cliente
    return new Response(groqResponse.body, {
        status: groqResponse.status,
        headers: {
            "Content-Type": groqResponse.headers.get("Content-Type") || "text/event-stream",
        },
    });
};
