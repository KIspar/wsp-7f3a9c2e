import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { MotionConfig, useReducedMotion, type Transition } from 'motion/react';
import { ReducedMotionContext } from '@animate-ui/react/utils/motion';

export const uiMotion = {
  enter: { type: 'tween', duration: .2, ease: [.23, 1, .32, 1] } satisfies Transition,
  exit: { type: 'tween', duration: .12, ease: [.23, 1, .32, 1] } satisfies Transition,
  panel: { type: 'tween', duration: .24, ease: [.32, .72, 0, 1] } satisfies Transition,
  selection: { type: 'spring', duration: .22, bounce: 0 } satisfies Transition,
  instant: { duration: 0 } satisfies Transition,
};

const MotionPreferences = createContext(false);

export function UiMotionProvider({ children }: { children: ReactNode }) {
  const systemReduced = useReducedMotion();
  const [keyboard, setKeyboard] = useState(false);
  useEffect(() => {
    const onKey = () => setKeyboard(true);
    const onPointer = () => setKeyboard(false);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer, true);
    };
  }, []);
  const reduce = !!systemReduced || keyboard;
  return <MotionPreferences.Provider value={reduce}>
    <ReducedMotionContext.Provider value={reduce ? 'always' : 'user'}>
      <MotionConfig reducedMotion={reduce ? 'always' : 'user'} transition={uiMotion.enter}>
        {children}
      </MotionConfig>
    </ReducedMotionContext.Provider>
  </MotionPreferences.Provider>;
}

export function useUiMotion() {
  const reduce = useContext(MotionPreferences);
  return { reduce, enter: reduce ? uiMotion.instant : uiMotion.enter, exit: reduce ? uiMotion.instant : uiMotion.exit, panel: reduce ? uiMotion.instant : uiMotion.panel, selection: reduce ? uiMotion.instant : uiMotion.selection };
}
