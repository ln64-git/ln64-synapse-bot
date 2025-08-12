import { ChannelType, Client, TextChannel } from "discord.js";
import { Db } from "mongodb";

export function trackServerAvailability(client: Client, db: Db) {
  const startTracking = () => {
    const availabilityChannel = client.channels.cache.find(
      (channel): channel is TextChannel =>
        channel.type === ChannelType.GuildText && channel.name === "availability",
    );
    if (!availabilityChannel) {
      console.warn("trackServerAvailability: no #availability text channel found.");
      return;
    }


    
    console.log("Server availability tracking started");
  };

  if (client.isReady()) {
    startTracking();
  } else {
    client.once("ready", startTracking);
  }
}


