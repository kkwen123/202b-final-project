import type { Request, Response, NextFunction } from "express";

import { UploadApiError } from "../types/api";

export function requireDeviceBearerToken(expectedToken: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const authorizationHeader = req.header("authorization") || "";
    const [scheme, token] = authorizationHeader.split(" ");

    if (scheme !== "Bearer" || !token || token !== expectedToken) {
      next(new UploadApiError(401, "UNAUTHORIZED", false, "Missing or invalid bearer token"));
      return;
    }

    next();
  };
}
