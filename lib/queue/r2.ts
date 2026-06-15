import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

function envOrThrow(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`${key} environment variable is required for R2 uploads`);
  return v;
}

let _s3: S3Client | null = null;

function s3(): S3Client {
  if (_s3) return _s3;
  _s3 = new S3Client({
    region: "auto",
    endpoint: envOrThrow("R2_ENDPOINT"),
    credentials: {
      accessKeyId: envOrThrow("R2_KEY"),
      secretAccessKey: envOrThrow("R2_SECRET"),
    },
  });
  return _s3;
}

export async function uploadR2(
  key: string,
  body: string | Buffer,
  contentType: string,
): Promise<string> {
  const bucket = envOrThrow("R2_BUCKET");
  const publicBase = envOrThrow("R2_PUBLIC_BASE").replace(/\/+$/, "");

  await s3().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );

  return `${publicBase}/${key}`;
}
