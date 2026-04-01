export function isRuntimeErrorResponse(value) {
    return (typeof value === "object" &&
        value !== null &&
        "error" in value &&
        typeof value.error === "string");
}
