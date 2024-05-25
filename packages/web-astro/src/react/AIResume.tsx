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
        <h1>
          <span> Hello there, </span>
          Welcome to A.I.R.! 👋
        </h1>
        The AI-powered Resume. <span className="underline decoration-double decoration-indigo-600 underline-offset-4 decoration-2 italic">Ask away...</span>
      </div>
      <div className="rounded-xl bg-purple-900 p-6 mt-4">
          <input ref={inputRef} className="flex p-4 rounded-xl mt-2 w-full text-black" placeholder="What's something you want to know about Eddie?" onKeyDown={handleKeyDown} />
          <div className="flex mt-4 p-4 rounded-xl bg-indigo-600"><span className="text-indigo-100">{question}</span></div>
      </div>
    </div>
  );
}