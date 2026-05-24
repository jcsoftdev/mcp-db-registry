export function toolError(message: string) {
  return { isError: true as const, content: [{ type: "text" as const, text: message }] };
}
