// src/notify/pushover.ts
import { request } from "undici";

export async function sendPushoverNotification(title: string, message: string) {
  const user = process.env.PUSHOVER_USER;
  const token = process.env.PUSHOVER_TOKEN;

  if (!user || !token) {
    throw new Error("Missing PUSHOVER_USER or PUSHOVER_TOKEN in environment.");
  }

  await request("https://api.pushover.net/1/messages.json", {
    method: "POST",
    body: new URLSearchParams({
      token,
      user,
      title,
      message,
      sound: "pushover",
    }).toString(),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    }
  });
}
