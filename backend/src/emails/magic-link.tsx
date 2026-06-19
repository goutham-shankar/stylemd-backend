import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Row,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";

interface MagicLinkEmailProps {
  signInLink: string;
}

const LOGO_PNG =
  "https://res.cloudinary.com/dsq5ntmyj/image/upload/f_png,w_280,dpr_2,q_100/v1781689949/Logo_t4dpbd.svg";

export function MagicLinkEmail({ signInLink }: MagicLinkEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Your secure sign-in link for getmd.design is ready</Preview>
      <Body style={body}>
        <Container style={wrapper}>
          {/* Logo */}
          <Section style={logoSection}>
            <Img
              src={LOGO_PNG}
              width="120"
              height="29"
              alt="getmd.design"
              style={logoStyle}
            />
            <Text style={tagline}>
              AI-powered design specifications from any website
            </Text>
          </Section>

          {/* Main card */}
          <Section style={card}>
            <Heading style={heading}>Welcome back</Heading>
            <Text style={subheading}>
              Your secure sign-in link is ready. Access your design workspace
              instantly.
            </Text>

            <Section style={ctaWrap}>
              <Button style={ctaButton} href={signInLink}>
                Continue to getmd.design &rarr;
              </Button>
            </Section>

            {/* Security */}
            <Section style={securityCard}>
              <Row style={securityHeader}>
                <Column style={shieldCol}>
                  <Text style={shieldText}>&#128737;&#65039;</Text>
                </Column>
                <Column>
                  <Text style={securityTitle}>Secure sign-in</Text>
                </Column>
              </Row>
              <Text style={securityItem}>
                &#8226;&ensp;This link expires in 10 minutes
              </Text>
              <Text style={securityItem}>
                &#8226;&ensp;It can only be used once
              </Text>
              <Text style={securityItem}>
                &#8226;&ensp;No password required
              </Text>
            </Section>

            <Hr style={divider} />

            <Text style={fallbackLabel}>
              Button not working? Copy and paste this link into your browser:
            </Text>
            <Section style={fallbackBox}>
              <Text style={fallbackLink}>{signInLink}</Text>
            </Section>
          </Section>

          {/* Product context */}
          <Text style={productContext}>
            <Link href="https://getmd.design" style={productLink}>
              getmd.design
            </Link>{" "}
            generates detailed DESIGN.md specifications from any website using
            AI — colours, typography, spacing, and component patterns ready to
            drop into your repo.
          </Text>

          {/* Footer */}
          <Section style={footer}>
            <Text style={footerBrand}>getmd.design</Text>
            <Text style={footerTagline}>
              AI Design Intelligence for developers and designers.
            </Text>
            <Hr style={footerDivider} />
            <Text style={footerMeta}>
              If you didn&apos;t request this email, you can safely ignore it.
              <br />
              No account changes have been made.
            </Text>
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

MagicLinkEmail.PreviewProps = {
  signInLink: "https://getmd.design/auth/callback?oobCode=abc123&mode=signIn",
} satisfies MagicLinkEmailProps;

export default MagicLinkEmail;

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

const tagline: React.CSSProperties = {
  fontSize: "13px",
  color: "#8b8b8b",
  margin: "8px 0 0",
  textAlign: "center" as const,
  letterSpacing: "0.01em",
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

const securityCard: React.CSSProperties = {
  backgroundColor: "#fafafa",
  borderRadius: "10px",
  border: "1px solid #f0f0f0",
  padding: "14px 16px 10px",
  marginBottom: "20px",
};

const securityHeader: React.CSSProperties = {
  marginBottom: "4px",
};

const shieldCol: React.CSSProperties = {
  width: "24px",
  verticalAlign: "middle" as const,
};

const shieldText: React.CSSProperties = {
  fontSize: "14px",
  margin: "0",
  lineHeight: "1",
};

const securityTitle: React.CSSProperties = {
  fontSize: "13px",
  fontWeight: 600,
  color: "#09090b",
  margin: "0",
};

const securityItem: React.CSSProperties = {
  fontSize: "13px",
  color: "#71717a",
  margin: "0",
  lineHeight: "1.9",
  paddingLeft: "2px",
};

const divider: React.CSSProperties = {
  borderColor: "#f0f0f0",
  borderTop: "1px solid #f0f0f0",
  margin: "0 0 16px",
};

const fallbackLabel: React.CSSProperties = {
  fontSize: "12px",
  color: "#a1a1aa",
  margin: "0 0 6px",
};

const fallbackBox: React.CSSProperties = {
  backgroundColor: "#fafafa",
  borderRadius: "8px",
  border: "1px solid #f0f0f0",
  padding: "8px 12px",
};

const fallbackLink: React.CSSProperties = {
  fontSize: "11px",
  lineHeight: "1.5",
  color: "#71717a",
  wordBreak: "break-all" as const,
  margin: "0",
  fontFamily:
    'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
};

const productContext: React.CSSProperties = {
  fontSize: "12px",
  lineHeight: "1.6",
  color: "#a1a1aa",
  textAlign: "center" as const,
  margin: "16px 0 0",
  padding: "0 8px",
};

const productLink: React.CSSProperties = {
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

const footerMeta: React.CSSProperties = {
  fontSize: "11px",
  lineHeight: "1.6",
  color: "#a1a1aa",
  margin: "0 0 10px",
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
