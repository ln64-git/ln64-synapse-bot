import { Attachment, Message } from "discord.js";
import vision from "@google-cloud/vision";

export type FiresideAttachment = {
  url?: string;
  summary?: string;
};

function isMediaUrl(url: string): boolean {
  const cleanUrl = url.split("?")[0];
  return /\.(jpg|jpeg|png|gif|mp4|webm|mov|avi)$/i.test(cleanUrl);
}

import path from "path";

async function analyzeImage(url: string): Promise<string> {
  const client = new vision.ImageAnnotatorClient({
    keyFilename: path.resolve(
      __dirname,
      "../../ln64-synapse-bot-7b618e20f7b1.json",
    ),
  });

  const [result] = await client.annotateImage({
    image: { source: { imageUri: url } },
    features: [{ type: "LABEL_DETECTION" }],
  });

  const labels = result.labelAnnotations || [];
  return labels.map((label) => label.description).join(", ");
}

async function fetchAttachmentDetails(attachment: Attachment) {
  const url = attachment.url;
  if (isMediaUrl(url)) {
    const summary = await analyzeImage(url);
    return {
      url,
      summary,
      name: attachment.name || "unknown",
      size: attachment.size,
    };
  }
  return null;
}

export async function extractMediaAttachments(message: Message<true>) {
  const mediaLinks: Array<FiresideAttachment> = [];

  for (const attachment of message.attachments.values()) {
    const details = await fetchAttachmentDetails(attachment);
    if (details) {
      mediaLinks.push(details);
    }
  }

  console.log("Valid attachments with summaries:", mediaLinks);
  return mediaLinks;
}
