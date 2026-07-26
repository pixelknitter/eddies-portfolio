import React, { type KeyboardEventHandler } from "react";

// FIXME: useState isn't working, maybe we need to switch to nanostores: https://docs.astro.build/en/recipes/sharing-state-islands/

export function AIResume() {
  const [question, setQuestion] = React.useState<string | undefined>()
  const inputRef = React.useRef<HTMLInputElement>(null)

  const handleKeyDown: KeyboardEventHandler<HTMLInputElement> = (keyboardEvent) => {
    if (keyboardEvent.key === "Enter" && inputRef.current) {
      setQuestion(inputRef.current.value)
    }
  }

  return (
    <div className="container mt-12">
      <div>
        <h1 className="center">
          <span> Hello there, </span>
          Welcome to A.I.R.! 👋
        </h1>
        The AI-powered Resume. <span className="underline decoration-underline dark:decoration-link underline-offset-4 decoration-2 italic">Ask away...</span>
      </div>
      <div className="surface p-6 mt-4">
          <input ref={inputRef} className="w-full p-3 rounded-lg mt-2 bg-light dark:bg-dark text-dark dark:text-light border border-hairline dark:border-hairline-dark focus:outline-2 focus:outline-offset-2 focus:outline-underline dark:focus:outline-link" placeholder="What's something you want to know about Eddie?" onKeyDown={handleKeyDown} />
          <div className="mt-4 p-4 rounded-lg bg-light dark:bg-dark border border-hairline dark:border-hairline-dark min-h-[3.5rem]"><span className="text-dark dark:text-light">{question}</span></div>
      </div>
    </div>
  );
}