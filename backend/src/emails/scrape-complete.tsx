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

export interface ScrapeCompleteEmailProps {
  hostname: string;
  slug: string;
  title?: string | null;
  screenshotUrl?: string | null;
  durationMs?: number | null;
  completedAt?: string | null;
}

const LOGO_PNG =
  "https://res.cloudinary.com/dsq5ntmyj/image/upload/f_png,w_280,dpr_2,q_100/v1781689949/Logo_t4dpbd.svg";

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`;
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function ScrapeCompleteEmail({
  hostname,
  slug,
  title,
  screenshotUrl,
  durationMs,
  completedAt,
}: ScrapeCompleteEmailProps) {
  const label = title || hostname;
  const viewUrl = `https://getmd.design/library/${slug}`;

  return (
    <Html>
      <Head />
      <Preview>Your DESIGN.md for {label} is ready</Preview>
      <Body style={body}>
        <Container style={wrapper}>
          {/* Logo + tagline */}
          <Section style={logoSection}>
            <Img
              src={LOGO_PNG}
              width="120"
              height="29"
              alt="getmd.design"
              style={logoImg}
            />
            <Text style={tagline}>
              AI-powered design specifications from any website
            </Text>
          </Section>

          {/* Main card */}
          <Section style={card}>
            {/* Hero */}
            <Heading style={heading}>
              Your DESIGN.md is ready &#10024;
            </Heading>
            <Text style={subheading}>
              We analyzed{" "}
              <span style={siteName}>{label}</span>{" "}
              and generated a complete AI-powered design specification. Your
              report is ready to explore.
            </Text>

            {/* Screenshot preview */}
            {screenshotUrl && (
              <Section style={previewWrap}>
                <Link href={viewUrl} style={previewLink}>
                  <Img
                    src={screenshotUrl}
                    width="496"
                    alt={`Preview of ${label}`}
                    style={previewImg}
                  />
                </Link>
              </Section>
            )}

            {/* Status row */}
            <Section style={statusRow}>
              <Row>
                <Column style={statusCol}>
                  <Text style={statusText}>
                    &#127760;&ensp;{hostname}
                  </Text>
                </Column>
                <Column style={statusCol} align="right">
                  <Text style={statusSuccess}>
                    &#10003;&ensp;Analysis complete
                  </Text>
                </Column>
              </Row>
              {durationMs != null && (
                <Text style={durationText}>
                  Generated in {formatDuration(durationMs)}
                </Text>
              )}
            </Section>

            {/* CTA */}
            <Section style={ctaWrap}>
              <Button style={ctaButton} href={viewUrl}>
                Open your DESIGN.md &rarr;
              </Button>
            </Section>

            <Hr style={sectionDivider} />

            {/* What's included */}
            <Text style={sectionTitle}>What you&apos;ll find inside</Text>

            <Section style={featureGrid}>
              <Row style={featureRow}>
                <Column style={featureIconCol}>
                  <Text style={featureIcon}>&#127912;</Text>
                </Column>
                <Column>
                  <Text style={featureLabel}>Colors &amp; design tokens</Text>
                </Column>
              </Row>
              <Row style={featureRow}>
                <Column style={featureIconCol}>
                  <Text style={featureIcon}>&#128292;</Text>
                </Column>
                <Column>
                  <Text style={featureLabel}>Typography system</Text>
                </Column>
              </Row>
              <Row style={featureRow}>
                <Column style={featureIconCol}>
                  <Text style={featureIcon}>&#129513;</Text>
                </Column>
                <Column>
                  <Text style={featureLabel}>
                    UI components &amp; patterns
                  </Text>
                </Column>
              </Row>
              <Row style={featureRow}>
                <Column style={featureIconCol}>
                  <Text style={featureIcon}>&#128208;</Text>
                </Column>
                <Column>
                  <Text style={featureLabel}>
                    Layout hierarchy &amp; spacing
                  </Text>
                </Column>
              </Row>
              <Row style={featureRow}>
                <Column style={featureIconCol}>
                  <Text style={featureIcon}>&#128241;</Text>
                </Column>
                <Column>
                  <Text style={featureLabel}>Responsive behavior</Text>
                </Column>
              </Row>
              <Row style={featureRow}>
                <Column style={featureIconCol}>
                  <Text style={featureIcon}>&#9889;</Text>
                </Column>
                <Column>
                  <Text style={featureLabel}>
                    AI-generated implementation insights
                  </Text>
                </Column>
              </Row>
            </Section>

            {/* Technical details */}
            {(completedAt || durationMs != null) && (
              <>
                <Hr style={sectionDivider} />
                <Section style={metaCard}>
                  <Row style={metaRow}>
                    <Column>
                      <Text style={metaLabel}>Website</Text>
                    </Column>
                    <Column align="right">
                      <Text style={metaValue}>{hostname}</Text>
                    </Column>
                  </Row>
                  {completedAt && (
                    <Row style={metaRow}>
                      <Column>
                        <Text style={metaLabel}>Completed</Text>
                      </Column>
                      <Column align="right">
                        <Text style={metaValue}>
                          {formatDate(completedAt)}
                        </Text>
                      </Column>
                    </Row>
                  )}
                  {durationMs != null && (
                    <Row style={metaRow}>
                      <Column>
                        <Text style={metaLabel}>Processing time</Text>
                      </Column>
                      <Column align="right">
                        <Text style={metaValue}>
                          {formatDuration(durationMs)}
                        </Text>
                      </Column>
                    </Row>
                  )}
                </Section>
              </>
            )}
          </Section>

          {/* Footer */}
          <Section style={footer}>
            <Text style={footerBrand}>getmd.design</Text>
            <Text style={footerTagline}>
              Turn any website into a structured DESIGN.md specification.
            </Text>
            <Hr style={footerDivider} />
            <Text style={footerHelp}>
              Need help?{" "}
              <Link href="mailto:support@getmd.design" style={footerLink}>
                support@getmd.design
              </Link>
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

ScrapeCompleteEmail.PreviewProps = {
  hostname: "stripe.com",
  slug: "stripe-com",
  title: "Stripe",
  screenshotUrl:
    "https://res.cloudinary.com/dsq5ntmyj/image/upload/v1781689949/Logo_t4dpbd.svg",
  durationMs: 47200,
  completedAt: new Date().toISOString(),
} satisfies ScrapeCompleteEmailProps;

export default ScrapeCompleteEmail;

/* ─── Styles ─── */

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

const logoImg: React.CSSProperties = {
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
  margin: "0 0 8px",
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

const siteName: React.CSSProperties = {
  fontWeight: 600,
  color: "#09090b",
};

const previewWrap: React.CSSProperties = {
  marginBottom: "16px",
};

const previewLink: React.CSSProperties = {
  display: "block",
  textDecoration: "none",
};

const previewImg: React.CSSProperties = {
  width: "100%",
  borderRadius: "10px",
  border: "1px solid #e4e4e7",
  display: "block",
};

const statusRow: React.CSSProperties = {
  marginBottom: "20px",
};

const statusCol: React.CSSProperties = {
  verticalAlign: "middle" as const,
};

const statusText: React.CSSProperties = {
  fontSize: "13px",
  color: "#71717a",
  margin: "0",
  lineHeight: "1.4",
};

const statusSuccess: React.CSSProperties = {
  fontSize: "13px",
  color: "#16a34a",
  fontWeight: 500,
  margin: "0",
  lineHeight: "1.4",
};

const durationText: React.CSSProperties = {
  fontSize: "12px",
  color: "#a1a1aa",
  margin: "4px 0 0",
};

const ctaWrap: React.CSSProperties = {
  textAlign: "center" as const,
  padding: "0 0 24px",
};

const ctaButton: React.CSSProperties = {
  backgroundColor: "#09090b",
  borderRadius: "12px",
  color: "#ffffff",
  fontSize: "15px",
  fontWeight: 600,
  fontFamily: font,
  textDecoration: "none",
  textAlign: "center" as const,
  padding: "16px 24px",
  boxSizing: "border-box" as const,
};

const sectionDivider: React.CSSProperties = {
  borderColor: "#f0f0f0",
  borderTop: "1px solid #f0f0f0",
  margin: "0 0 20px",
};

const sectionTitle: React.CSSProperties = {
  fontSize: "14px",
  fontWeight: 600,
  color: "#09090b",
  margin: "0 0 14px",
  letterSpacing: "-0.01em",
};

const featureGrid: React.CSSProperties = {
  marginBottom: "20px",
};

const featureRow: React.CSSProperties = {
  marginBottom: "2px",
};

const featureIconCol: React.CSSProperties = {
  width: "28px",
  verticalAlign: "middle" as const,
};

const featureIcon: React.CSSProperties = {
  fontSize: "14px",
  margin: "0",
  lineHeight: "1",
};

const featureLabel: React.CSSProperties = {
  fontSize: "13px",
  color: "#52525b",
  margin: "0",
  lineHeight: "2",
};

const metaCard: React.CSSProperties = {
  backgroundColor: "#fafafa",
  borderRadius: "10px",
  border: "1px solid #f0f0f0",
  padding: "12px 16px 4px",
  marginBottom: "4px",
};

const metaRow: React.CSSProperties = {
  marginBottom: "0",
};

const metaLabel: React.CSSProperties = {
  fontSize: "12px",
  color: "#a1a1aa",
  margin: "0",
  lineHeight: "2.2",
};

const metaValue: React.CSSProperties = {
  fontSize: "12px",
  color: "#52525b",
  fontWeight: 500,
  margin: "0",
  lineHeight: "2.2",
  fontFamily:
    'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
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

const footerHelp: React.CSSProperties = {
  fontSize: "12px",
  color: "#a1a1aa",
  margin: "0 0 8px",
};

const footerLink: React.CSSProperties = {
  color: "#71717a",
  textDecoration: "underline",
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
