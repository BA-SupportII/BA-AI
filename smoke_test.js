const baseUrl = process.env.BASE_URL || "http://localhost:4000";

async function post(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  return { status: response.status, text };
}

async function run() {
  console.log("Health:", await fetch(`${baseUrl}/health`).then((r) => r.text()));
  console.log("Greeting:", await post("/api/auto", { prompt: "hi", auto: true }));
  console.log("Tool python:", await post("/api/auto", { prompt: "/python print(2+2)", auto: true }));
  console.log("Tool sql:", await post("/api/auto", { prompt: "/sql select 1", auto: true }));
  console.log("Chart:", await post("/api/auto", { prompt: "make an svg bar chart for sales A=10 B=20", auto: true }));
  console.log("Memory:", await post("/api/memory/store", { prompt: "remember this: test", response: "ok", meta: { force: true } }));
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
