declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    TOKEN_ENCRYPTION_KEY?: string;
    APP_PASSWORD?: string;
    X_CLIENT_ID?: string;
    X_CLIENT_SECRET?: string;
    LINKEDIN_CLIENT_ID?: string;
    LINKEDIN_CLIENT_SECRET?: string;
    LINKEDIN_VERSION?: string;
  }
}
