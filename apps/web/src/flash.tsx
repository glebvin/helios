import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

export function Flash({ message, pulse = 0 }: { message: string; pulse?: number }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(message);
  useEffect(() => {
    setShown(message);
    if (!message) return;
    const timer = window.setTimeout(() => setShown(""), 3400);
    return () => window.clearTimeout(timer);
  }, [message, pulse]);
  return (
    <AnimatePresence>
      {shown ? (
        <motion.p className="flash" role="status" key={shown} initial={{ opacity: 0, y: reduce ? 0 : 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduce ? 0 : 6 }} transition={{ type: "spring", bounce: 0, duration: reduce ? 0 : 0.28 }}>
          {shown}
        </motion.p>
      ) : null}
    </AnimatePresence>
  );
}
