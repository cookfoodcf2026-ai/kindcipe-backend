/**
 * Cloudflare R2 Storage Helper
 * 替換 Manus 內建 S3 Storage
 *
 * 需要的環境變數：
 *   R2_ACCOUNT_ID       - Cloudflare Account ID
 *   R2_ACCESS_KEY_ID    - R2 API Access Key ID
 *   R2_SECRET_ACCESS_KEY - R2 API Secret Access Key
 *   R2_BUCKET_NAME      - Bucket 名稱（例如 kindcipe-storage）
 *   R2_PUBLIC_URL       - 公開存取 URL（例如 https://pub-xxx.r2.dev 或自訂域名）
 */

import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function getR2Config() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.R2_BUCKET_NAME;
  const publicUrl = process.env.R2_PUBLIC_URL;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
    throw new Error(
      "R2 config missing: set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME"
    );
  }

  return { accountId, accessKeyId, secretAccessKey, bucketName, publicUrl };
}

function getS3Client() {
  const { accountId, accessKeyId, secretAccessKey } = getR2Config();

  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
}

function appendHashSuffix(relKey: string): string {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

/**
 * 上傳檔案到 R2
 * 返回 { key, url } — url 是公開存取 URL
 */
export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  const { bucketName, publicUrl } = getR2Config();
  const client = getS3Client();
  const key = appendHashSuffix(normalizeKey(relKey));

  const body = typeof data === "string" ? Buffer.from(data) : data;

  await client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );

  // 如果有設定公開 URL（R2 public bucket 或自訂域名），直接返回公開 URL
  // 否則返回 /r2-storage/ 路徑（需要後端代理）
  const url = publicUrl
    ? `${publicUrl.replace(/\/+$/, "")}/${key}`
    : `/r2-storage/${key}`;

  return { key, url };
}

/**
 * 取得檔案的存取 URL
 * 如果有公開 URL 設定，返回公開 URL；否則返回預簽名 URL（有效期 1 小時）
 */
export async function storageGet(
  relKey: string
): Promise<{ key: string; url: string }> {
  const { publicUrl } = getR2Config();
  const key = normalizeKey(relKey);

  if (publicUrl) {
    return { key, url: `${publicUrl.replace(/\/+$/, "")}/${key}` };
  }

  // 沒有公開 URL，生成預簽名 URL
  const url = await storageGetSignedUrl(key);
  return { key, url };
}

/**
 * 生成預簽名 GET URL（有效期 1 小時）
 */
export async function storageGetSignedUrl(
  relKey: string,
  expiresIn = 3600
): Promise<string> {
  const { bucketName } = getR2Config();
  const client = getS3Client();
  const key = normalizeKey(relKey);

  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: key,
  });

  return getSignedUrl(client, command, { expiresIn });
}
