import { Attachment, Message } from "npm:discord.js"; // Adjust imports based on your environment

export type FiresideAttachment = {
  url?: string;
  summary?: string;
  ocrText?: string;
};

function isMediaUrl(url: string): boolean {
  // Remove query parameters from the URL
  const cleanUrl = url.split("?")[0];
  // Test if the clean URL ends with a valid media extension
  return /\.(jpg|jpeg|png|gif|mp4|webm|mov|avi)$/i.test(cleanUrl);
}

// Function to fetch media details from attachments
function fetchAttachmentDetails(attachment: Attachment) {
  const url = attachment.url;
  if (isMediaUrl(url)) {
    return {
      url,
      name: attachment.name || "unknown",
      size: attachment.size, // Size in bytes
    };
  }
  return null; // Return null if the attachment isn't media
}

export function extractMediaAttachments(message: Message<true>) {
  const mediaLinks: Array<{ url: string }> = [];

  // Check if message has valid attachments
  message.attachments.forEach((attachment: Attachment) => {
    const details = fetchAttachmentDetails(attachment);
    if (details) {
      mediaLinks.push(details);
    }
  });

  console.log("Valid attachments:", mediaLinks);
  return mediaLinks;
}
