import { v2 as cloudinary } from "cloudinary";
import { z } from "zod";

const invoiceSchema = z.object({
  invoiceNumber: z.string().nullable(),
  vendor: z.string().nullable(),
  invoiceDate: z.string().nullable(),
  total: z.number().nonnegative().nullable(),
  currency: z.string().length(3).nullable(),
}).strict();

const generatedSchema = z.object({
  extractedText: z.string().min(1),
  data: invoiceSchema,
  confidence: z.number().min(0).max(1).nullable().optional(),
}).strict();

export type DocumentExtraction = z.infer<typeof generatedSchema>;

export class ProcessingError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ProcessingError";
  }
}

export async function processDocument(input: { storageKey: string; mimeType: string; filename: string }): Promise<DocumentExtraction & { model: string; inputTokens: number; outputTokens: number }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new ProcessingError("PROVIDER_NOT_CONFIGURED", "GEMINI_API_KEY is required to process documents");
  if (!new Set(["application/pdf", "image/jpeg", "image/png"]).has(input.mimeType)) {
    throw new ProcessingError("UNSUPPORTED_DOCUMENT", `Unsupported document type: ${input.mimeType}`);
  }

  const bytes = await downloadDocument(input.storageKey, input.mimeType);
  if (bytes.byteLength === 0 || bytes.byteLength > 20 * 1024 * 1024) {
    throw new ProcessingError("INVALID_DOCUMENT_SIZE", "Document must be between 1 byte and 20 MiB");
  }

  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  const baseUrl = (process.env.GEMINI_API_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(Number(process.env.GEMINI_TIMEOUT_MS ?? 60000)),
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [
            { text: "Read this invoice document. Perform OCR if needed. Return one JSON object with extractedText containing the complete readable document text and data containing invoiceNumber, vendor, invoiceDate (ISO YYYY-MM-DD when known), total (number without currency symbol), and currency (three-letter ISO code). Use null for unknown fields. confidence must be a number from 0 to 1 or null. Do not infer facts that are not present." },
            { inlineData: { mimeType: input.mimeType, data: bytes.toString("base64") } },
          ],
        }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              extractedText: { type: "STRING" },
              data: {
                type: "OBJECT",
                properties: {
                  invoiceNumber: { type: "STRING", nullable: true },
                  vendor: { type: "STRING", nullable: true },
                  invoiceDate: { type: "STRING", nullable: true },
                  total: { type: "NUMBER", nullable: true },
                  currency: { type: "STRING", nullable: true },
                },
                required: ["invoiceNumber", "vendor", "invoiceDate", "total", "currency"],
              },
              confidence: { type: "NUMBER", nullable: true },
            },
            required: ["extractedText", "data", "confidence"],
          },
        },
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gemini request failed";
    throw new ProcessingError("PROVIDER_UNAVAILABLE", message.slice(0, 1000));
  }
  if (!response.ok) {
    const message = (await response.text()).slice(0, 1000);
    throw new ProcessingError("PROVIDER_REQUEST_FAILED", `Gemini returned ${response.status}: ${message}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ProcessingError("INVALID_MODEL_RESPONSE", "Gemini returned invalid JSON");
  }
  const candidateText = (payload as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
    .candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
  if (!candidateText) throw new ProcessingError("INVALID_MODEL_RESPONSE", "Gemini returned no extraction content");

  let generated: unknown;
  try {
    generated = JSON.parse(candidateText);
  } catch {
    throw new ProcessingError("INVALID_MODEL_RESPONSE", "Gemini returned malformed extraction JSON");
  }
  const parsed = generatedSchema.safeParse(generated);
  if (!parsed.success) {
    throw new ProcessingError("INVALID_MODEL_RESPONSE", `Gemini extraction failed schema validation: ${parsed.error.issues.map((issue) => issue.path.join(".") + " " + issue.message).join("; ")}`);
  }
  const usage = (payload as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } }).usageMetadata;
  return {
    ...parsed.data,
    model,
    inputTokens: Number.isSafeInteger(usage?.promptTokenCount) && (usage?.promptTokenCount ?? 0) >= 0 ? usage!.promptTokenCount! : 0,
    outputTokens: Number.isSafeInteger(usage?.candidatesTokenCount) && (usage?.candidatesTokenCount ?? 0) >= 0 ? usage!.candidatesTokenCount! : 0,
  };
}

async function downloadDocument(storageKey: string, mimeType: string) {
  const sourceBaseUrl = process.env.DOCUMENT_SOURCE_BASE_URL;
  let url: string;
  if (/^https?:\/\//i.test(storageKey)) {
    const storageUrl = new URL(storageKey);
    if (storageUrl.protocol !== "https:" && storageUrl.hostname !== "127.0.0.1" && storageUrl.hostname !== "localhost") {
      throw new ProcessingError("INVALID_STORAGE_URL", "Document storage URL must use HTTPS");
    }
    const allowedHosts = [process.env.CLOUDINARY_CLOUD_NAME ? `${process.env.CLOUDINARY_CLOUD_NAME}.res.cloudinary.com` : "", "res.cloudinary.com", "127.0.0.1", "localhost"].filter(Boolean);
    const proxyHost = sourceBaseUrl ? new URL(sourceBaseUrl).hostname : "";
    if (!allowedHosts.includes(storageUrl.hostname) && storageUrl.hostname !== proxyHost) {
      throw new ProcessingError("INVALID_STORAGE_URL", "Document storage URL host is not trusted");
    }
    url = storageKey;
  } else if (sourceBaseUrl) {
    url = `${sourceBaseUrl.replace(/\/$/, "")}/${storageKey.split("/").map(encodeURIComponent).join("/")}`;
  } else {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    if (!cloudName || !apiKey || !apiSecret) {
      throw new ProcessingError("STORAGE_NOT_CONFIGURED", "Configure Cloudinary credentials to download documents");
    }
    cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
    const resourceType = mimeType === "application/pdf" ? "raw" : "image";
    const extension = resourceType === "raw" ? storageKey.split(".").pop() ?? "pdf" : mimeType === "image/jpeg" ? "jpg" : "png";
    url = cloudinary.utils.private_download_url(storageKey, extension, {
      type: "authenticated",
      resource_type: resourceType,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    });
  }

  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(Number(process.env.DOCUMENT_DOWNLOAD_TIMEOUT_MS ?? 30000)) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Document download failed";
    throw new ProcessingError("STORAGE_UNAVAILABLE", message.slice(0, 1000));
  }
  if (!response.ok) throw new ProcessingError("DOCUMENT_DOWNLOAD_FAILED", `Document download returned ${response.status}`);
  const contentType = response.headers.get("content-type")?.split(";")[0];
  if (contentType && contentType !== mimeType && contentType !== "application/octet-stream") {
    throw new ProcessingError("DOCUMENT_TYPE_MISMATCH", `Expected ${mimeType}, received ${contentType}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const contentLength = response.headers.get("content-length");
  if ((contentLength !== null && Number(contentLength) > 20 * 1024 * 1024) || bytes.byteLength > 20 * 1024 * 1024) {
    throw new ProcessingError("INVALID_DOCUMENT_SIZE", "Document exceeds the 20 MiB processing limit");
  }
  return bytes;
}
