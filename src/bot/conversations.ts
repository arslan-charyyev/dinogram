import type {
  Conversation,
  ConversationBuilder,
} from "@grammyjs/conversations";
import type { DinoContext, DinoParseModeContext } from "./dinogram.ts";

export type DinoConversationContext = DinoParseModeContext;

export type DinoConversation = Conversation<
  DinoContext,
  DinoConversationContext
>;
export type DinoConversationBuilder = ConversationBuilder<
  DinoContext,
  DinoParseModeContext
>;

const registeredConversations: DinoConversationBuilder[] = [];

export function registerConversation(conversation: DinoConversationBuilder) {
  registeredConversations.push(conversation);
}

export function getRegisteredConversation() {
  return registeredConversations;
}
