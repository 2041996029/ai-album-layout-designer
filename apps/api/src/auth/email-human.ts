import type { EmailIdentityService } from "./email";
import type { HumanReauthAdapter } from "./reauthentication";
export function emailHumanAdapter(
  email: EmailIdentityService,
): HumanReauthAdapter {
  return {
    method: "email",
    async start(input) {
      const q = await email.start(
        await email.linkedDestination(input.actor),
        "reauth",
        input.actor,
        "reauth:" + input.actor.userId,
        input.challengeId,
      );
      return { destinationHint: q.destinationHint };
    },
    complete(input) {
      return email
        .adapter("reauth")
        .exchange(
          JSON.stringify({ challengeId: input.challengeId, code: input.code }),
          null,
          { actor: input.actor, purpose: input.purpose },
        );
    },
  };
}
