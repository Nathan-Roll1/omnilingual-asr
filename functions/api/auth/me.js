export async function onRequestGet({ env, data }) {
  return new Response(
    JSON.stringify({
      user: {
        id: data.userId,
        email: data.email,
      },
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
}
