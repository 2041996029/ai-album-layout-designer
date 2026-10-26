import nodemailer from "nodemailer";
import { fail } from "@album/server-core";
import type { EmailSender } from "./email";
export function smtpSender(options: {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
}): EmailSender {
  if (
    !options.host ||
    !options.user ||
    !options.password ||
    !options.from ||
    !Number.isInteger(options.port)
  )
    fail("SMTP_CONFIGURATION_REQUIRED", 503);
  const transport = nodemailer.createTransport({
    host: options.host,
    port: options.port,
    secure: options.secure,
    requireTLS: !options.secure,
    auth: { user: options.user, pass: options.password },
    connectionTimeout: 10000,
    socketTimeout: 15000,
    logger: false,
    debug: false,
  });
  return {
    async send({ to, code, purpose }) {
      await transport.sendMail({
        from: options.from,
        to,
        subject: "拾光 · 邮箱验证码",
        text: `你的${purpose === "login" ? "登录" : "身份验证"}验证码为 ${code}，5 分钟内有效。请勿向他人提供验证码。如非本人操作，请忽略此邮件。`,
      });
    },
  };
}
