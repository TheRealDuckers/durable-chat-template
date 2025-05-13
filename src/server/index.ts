import {
  type Connection,
  Server,
  type WSMessage,
  routePartykitRequest,
} from "partyserver";

import type { ChatMessage, Message } from "../shared";

export class Chat extends Server<Env> {
  static options = { hibernate: true };

  messages = [] as ChatMessage[];

  broadcastMessage(message: Message, exclude?: string[]) {
    this.broadcast(JSON.stringify(message), exclude);
  }

  onStart() {
    // Initialize things that need to be done before the server starts
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, user TEXT, role TEXT, content TEXT)`,
    );

    this.messages = this.ctx.storage.sql
      .exec(`SELECT * FROM messages`)
      .toArray() as ChatMessage[];
  }

  onConnect(connection: Connection) {
    // Send existing messages to the newly connected user
    connection.send(
      JSON.stringify({
        type: "all",
        messages: this.messages,
      } satisfies Message),
    );

    // Prompt the user to pick a name
    connection.send(
      JSON.stringify({
        type: "namePrompt",
        message: "Please set your name to continue.",
      }),
    );

    // Store the user's name in the connection object (default to 'Anonymous')
    connection.userName = "Anonymous";
  }

  saveMessage(message: ChatMessage) {
    const existingMessage = this.messages.find((m) => m.id === message.id);
    if (existingMessage) {
      this.messages = this.messages.map((m) =>
        m.id === message.id ? message : m,
      );
    } else {
      this.messages.push(message);
    }

    this.ctx.storage.sql.exec(
      `INSERT INTO messages (id, user, role, content) VALUES ('${
        message.id
      }', '${message.user}', '${message.role}', ${JSON.stringify(
        message.content,
      )}) ON CONFLICT (id) DO UPDATE SET content = ${JSON.stringify(
        message.content,
      )}`,
    );
  }

  onMessage(connection: Connection, message: WSMessage) {
    const parsed = JSON.parse(message as string) as Message;

    // Handle name selection
    if (parsed.type === "setName") {
      connection.userName = parsed.name; // Set user's name
      connection.send(
        JSON.stringify({
          type: "nameSet",
          message: `Your name has been set to ${parsed.name}.`,
        }),
      );
      return;
    }

    // Handle message addition or update
    if (parsed.type === "add" || parsed.type === "update") {
      parsed.user = connection.userName; // Associate the message with the user's name
      this.saveMessage(parsed);
    }

    // Broadcast the message to others
    this.broadcast(message);
  }
}

export default {
  async fetch(request, env) {
    return (
      (await routePartykitRequest(request, { ...env })) ||
      env.ASSETS.fetch(request)
    );
  },
} satisfies ExportedHandler<Env>;
