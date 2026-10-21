import { describe, expect, it } from "vitest";
import {
  emailsIn,
  linkPhones,
  phoneHref,
  smsHref,
  splitLinks,
  splitUrls,
  whatsAppHref,
} from "./links.ts";

describe("odkazy v textu", () => {
  it("nechá běžný text být", () => {
    expect(splitUrls("Koupit chleba")).toEqual([
      { kind: "text", value: "Koupit chleba" },
    ]);
  });

  it("udělá z adresy odkaz a oddělí koncovou tečku", () => {
    expect(splitUrls("viz https://example.com/a.")).toEqual([
      { kind: "text", value: "viz " },
      {
        kind: "url",
        value: "https://example.com/a",
        href: "https://example.com/a",
      },
      { kind: "text", value: "." },
    ]);
  });

  it("doplní https u www a nechá závorku, která patří k adrese", () => {
    expect(
      splitUrls("www.example.com a https://cs.wikipedia.org/wiki/Dům_(stavba)")
    ).toEqual([
      {
        kind: "url",
        value: "www.example.com",
        href: "https://www.example.com",
      },
      { kind: "text", value: " a " },
      {
        kind: "url",
        value: "https://cs.wikipedia.org/wiki/Dům_(stavba)",
        href: "https://cs.wikipedia.org/wiki/Dům_(stavba)",
      },
    ]);
  });

  it("udělá z čísla odkaz k vytočení a datum nechá být", () => {
    expect(phoneHref("777 123 456")).toBe("tel:+420777123456");
    expect(phoneHref("+420 777 123 456")).toBe("tel:+420777123456");
    expect(phoneHref("420777123456")).toBe("tel:+420777123456");
    expect(
      splitLinks("kancelář 4.12 777 123 456").filter(
        (part) => part.kind === "phone"
      )
    ).toEqual([
      { kind: "phone", value: "777 123 456", href: "tel:+420777123456" },
    ]);
    expect(splitLinks("zavolej 777 123 456.")).toEqual([
      { kind: "text", value: "zavolej " },
      { kind: "phone", value: "777 123 456", href: "tel:+420777123456" },
      { kind: "text", value: "." },
    ]);
    expect(splitLinks("termín 15.11.2026 a 2026-10-20")).toEqual([
      { kind: "text", value: "termín 15.11.2026 a 2026-10-20" },
    ]);
    expect(linkPhones("číslo 777123456 a [web](https://example.com)")).toBe(
      "číslo [777123456](tel:+420777123456) a [web](https://example.com)"
    );
    expect(linkPhones("viz https://example.com/777123456")).toBe(
      "viz https://example.com/777123456"
    );
    expect(smsHref("777 123 456")).toBe("sms:+420777123456");
    expect(whatsAppHref("777 123 456")).toBe("https://wa.me/420777123456");
    expect(emailsIn("napiš jan@firma.cz.")).toEqual([
      { value: "jan@firma.cz", href: "mailto:jan@firma.cz" },
    ]);
    expect(splitLinks("VS 1234567890")).toEqual([
      { kind: "text", value: "VS 1234567890" },
    ]);
    expect(linkPhones("napiš jan@firma.cz")).toBe(
      "napiš [jan@firma.cz](mailto:jan@firma.cz)"
    );
  });
});
