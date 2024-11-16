import {Message, Attachment} from "npm:discord.js" // Adjust imports based on your environment

// Helper function to check if a URL is an image or video
function isMediaUrl(url: string): boolean {
  return /\.(jpg|jpeg|png|gif|mp4|webm|mov|avi)$/i.test(url)
}

// Function to fetch media details from attachments
function fetchAttachmentDetails(attachment: Attachment) {
  const url = attachment.url

  if (isMediaUrl(url)) {
    return {
      url,
      name: attachment.name || "unknown",
      size: attachment.size, // Size in bytes
    }
  }
  return null // Return null if the attachment isn't media
}

// Main function to extract media attachments from a message
export async function extractMediaAttachments(message: Message<true>) {
  const mediaLinks: Array<{url: string}> = []

  // 1. Check if message content has any media links
  const urls = message.content.match(/https?:\/\/\S+/gi)
  if (urls) {
    console.log("URL found in message content:", urls)
    for (const url of urls) {
      if (isMediaUrl(url)) {
        mediaLinks.push({url})
      }
    }
  }

  // 2. Convert attachments to an array and check for media
  const mediaAttachmentsDetails = await Promise.all(
    Array.from(message.attachments.values()).map((attachment) =>
      fetchAttachmentDetails(attachment as Attachment)
    )
  )

  // Filter out null results
  const validAttachments = mediaAttachmentsDetails.filter(
    (details) => details !== null
  )

  console.log("Valid attachments:", validAttachments)

  return [...mediaLinks, ...validAttachments]
}
