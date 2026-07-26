import React, { type KeyboardEventHandler } from "react";

// FIXME: answers are echoed back rather than generated. See issue #3 — the
// real implementation retrieves from the STAR and project collections.

export function AIResume() {
  const [question, setQuestion] = React.useState<string | undefined>()
  const inputRef = React.useRef<HTMLInputElement>(null)

  const handleKeyDown: KeyboardEventHandler<HTMLInputElement> = (keyboardEvent) => {
    if (keyboardEvent.key === "Enter" && inputRef.current) {
      setQuestion(inputRef.current.value)
    }
  }

  return (
    // No `container` here: the page body already constrains and pads the
    // column, and nesting a second max-width put this section on a different
    // left edge to every other page.
    <section>
      <h1>Hello there, Welcome to A.I.R.! 👋</h1>
      <p className="font-body text-lg">
        The AI-powered Resume.{" "}
        <span className="underline decoration-underline dark:decoration-link underline-offset-4 decoration-2 italic">
          Ask away...
        </span>
      </p>

      <div className="surface p-4 sm:p-6 mt-6">
        <label htmlFor="air-question" className="block font-body font-semibold mb-2">
          Ask a question
        </label>
        <input
          id="air-question"
          ref={inputRef}
          className="w-full p-3 rounded-lg bg-light dark:bg-dark text-dark dark:text-light border border-hairline dark:border-hairline-dark focus:outline-2 focus:outline-offset-2 focus:outline-underline dark:focus:outline-link"
          placeholder="What's something you want to know about Eddie?"
          onKeyDown={handleKeyDown}
        />
        <p className="font-body text-sm opacity-70 mt-2">Press Enter to ask.</p>

        {/* An empty bordered box reads as broken, so the answer area only
            appears once there is something to show. */}
        {question && (
          <div
            className="mt-4 p-4 rounded-lg bg-light dark:bg-dark border border-hairline dark:border-hairline-dark"
            aria-live="polite"
          >
            <p className="font-body text-sm opacity-70 mb-1">You asked</p>
            <p className="text-dark dark:text-light">{question}</p>
          </div>
        )}
      </div>
    </section>
  );
}
