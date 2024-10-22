-- CreateTable
CREATE TABLE "Guild" (
    "id" TEXT PRIMARY KEY,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Channel" (
    "id" TEXT PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "guildId" TEXT NOT NULL,
    FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Member" (
    "id" TEXT PRIMARY KEY,
    "username" TEXT NOT NULL,
    "discriminator" TEXT NOT NULL,
    "nickname" TEXT,
    "joinedAt" TIMESTAMP NOT NULL,
    "guildId" TEXT NOT NULL,
    FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT PRIMARY KEY,
    "content" TEXT NOT NULL,
    "timestamp" TIMESTAMP NOT NULL,
    "editedTimestamp" TIMESTAMP,
    "tts" BOOLEAN NOT NULL,
    "mentionEveryone" BOOLEAN NOT NULL,
    "channelId" TEXT NOT NULL,
    "authorId" TEXT,
    FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    FOREIGN KEY ("authorId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);