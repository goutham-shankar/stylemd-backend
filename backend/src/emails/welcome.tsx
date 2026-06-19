import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";

interface WelcomeEmailProps {
  name: string;
}

const LOGO_PNG =
  "https://res.cloudinary.com/dsq5ntmyj/image/upload/f_png,w_280,dpr_2,q_100/v1781689949/Logo_t4dpbd.svg";

export function WelcomeEmail({ name }: WelcomeEmailProps) {
  const displayName = name || "there";

  return (
    <Html>
      <Head />
      <Preview>Welcome to getmd.design — design specs from any website</Preview>
      <Body style={body}>
        <Container style={wrapper}>
          <Section style={logoSection}>
            <Img
              src={LOGO_PNG}
              width="120"
              height="29"
              alt="getmd.design"
              style={logoStyle}
            />
          </Section>

          <Section style={card}>
            <Heading style={heading}>Welcome, {displayName}!</Heading>
            <Text style={subheading}>
              You&apos;re all set. Paste any website URL and we&apos;ll generate
              a complete DESIGN.md — colours, typography, components, and more —
              in seconds.
            </Text>

            <Section style={ctaWrap}>
              <Button style={ctaButton} href="https://getmd.design">
                Get started &rarr;
              </Button>
            </Section>

            <Hr style={divider} />

            <Text style={tipText}>
              Browse the{" "}
              <Link href="https://getmd.design/library" style={tipLink}>
                style library
              </Link>{" "}
              for inspiration.
            </Text>
          </Section>

          <Section style={footer}>
            <Text style={footerBrand}>getmd.design</Text>
            <Text style={footerTagline}>
              AI Design Intelligence for developers and designers.
            </Text>
            <Hr style={footerDivider} />
            <Text style={footerCopy}>
              &copy; 2026{" "}
              <Link href="https://getmd.design" style={footerCopyLink}>
                getmd.design
              </Link>
              . All rights reserved.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

WelcomeEmail.PreviewProps = {
  name: "Goutham",
} satisfies WelcomeEmailProps;

export default WelcomeEmail;

const font =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Ubuntu, sans-serif';

const body: React.CSSProperties = {
  backgroundColor: "#f4f4f5",
  fontFamily: font,
  margin: 0,
  padding: 0,
};

const wrapper: React.CSSProperties = {
  maxWidth: "560px",
  margin: "0 auto",
  padding: "48px 20px 32px",
};

const logoSection: React.CSSProperties = {
  textAlign: "center" as const,
  paddingBottom: "24px",
};

const logoStyle: React.CSSProperties = {
  margin: "0 auto",
  display: "block",
};

const card: React.CSSProperties = {
  backgroundColor: "#ffffff",
  borderRadius: "12px",
  border: "1px solid #e4e4e7",
  padding: "36px 32px 32px",
};

const heading: React.CSSProperties = {
  fontSize: "24px",
  fontWeight: 700,
  color: "#09090b",
  textAlign: "center" as const,
  margin: "0 0 6px",
  letterSpacing: "-0.02em",
  lineHeight: "1.3",
};

const subheading: React.CSSProperties = {
  fontSize: "14px",
  lineHeight: "1.6",
  color: "#71717a",
  textAlign: "center" as const,
  margin: "0 0 24px",
};

const ctaWrap: React.CSSProperties = {
  textAlign: "center" as const,
  padding: "0 0 24px",
};

const ctaButton: React.CSSProperties = {
  backgroundColor: "#09090b",
  borderRadius: "10px",
  color: "#ffffff",
  fontSize: "15px",
  fontWeight: 600,
  fontFamily: font,
  textDecoration: "none",
  textAlign: "center" as const,
  padding: "14px 24px",
  boxSizing: "border-box" as const,
};

const divider: React.CSSProperties = {
  borderColor: "#f0f0f0",
  borderTop: "1px solid #f0f0f0",
  margin: "0 0 16px",
};

const tipText: React.CSSProperties = {
  fontSize: "13px",
  lineHeight: "1.6",
  color: "#a1a1aa",
  textAlign: "center" as const,
  margin: "0",
};

const tipLink: React.CSSProperties = {
  color: "#71717a",
  textDecoration: "underline",
};

const footer: React.CSSProperties = {
  textAlign: "center" as const,
  padding: "24px 0 0",
};

const footerBrand: React.CSSProperties = {
  fontSize: "14px",
  fontWeight: 600,
  color: "#71717a",
  margin: "0 0 2px",
  letterSpacing: "-0.01em",
};

const footerTagline: React.CSSProperties = {
  fontSize: "12px",
  color: "#a1a1aa",
  margin: "0 0 14px",
};

const footerDivider: React.CSSProperties = {
  borderColor: "#e4e4e7",
  borderTop: "1px solid #e4e4e7",
  margin: "0 40px 14px",
};

const footerCopy: React.CSSProperties = {
  fontSize: "11px",
  color: "#d4d4d8",
  margin: "0",
};

const footerCopyLink: React.CSSProperties = {
  color: "#a1a1aa",
  textDecoration: "none",
};
