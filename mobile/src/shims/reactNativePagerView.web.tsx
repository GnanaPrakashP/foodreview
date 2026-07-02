import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState
} from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

type PagerEventHandler = (event: {
  eventName?: string;
  nativeEvent?: { offset?: number; position?: number; pageScrollState?: string };
  offset?: number;
  pageScrollState?: string;
  position?: number;
}) => void;

type PagerViewProps = {
  children?: React.ReactNode;
  initialPage?: number;
  onPageScroll?: PagerEventHandler;
  onPageScrollStateChanged?: PagerEventHandler;
  onPageSelected?: PagerEventHandler;
  scrollEnabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

export type PagerViewRef = {
  setPage: (page: number) => void;
  setPageWithoutAnimation: (page: number) => void;
  setScrollEnabled: (enabled: boolean) => void;
};

function clampPage(page: number, pageCount: number) {
  if (pageCount <= 0) return 0;
  return Math.max(0, Math.min(page, pageCount - 1));
}

const PagerView = forwardRef<PagerViewRef, PagerViewProps>(function PagerView(
  {
    children,
    initialPage = 0,
    onPageScroll,
    onPageScrollStateChanged,
    onPageSelected,
    style
  },
  ref
) {
  const pages = React.Children.toArray(children);
  const [page, setPageState] = useState(() => clampPage(initialPage, pages.length));
  const scrollEnabledRef = useRef(true);

  const emitPage = useCallback((nextPage: number) => {
    const position = clampPage(nextPage, pages.length);
    const scrollEvent = {
      eventName: "onPageScroll",
      nativeEvent: { offset: 0, position },
      offset: 0,
      position
    };
    onPageScrollStateChanged?.({
      eventName: "onPageScrollStateChanged",
      nativeEvent: { pageScrollState: "settling" },
      pageScrollState: "settling"
    });
    onPageScroll?.(scrollEvent);
    onPageSelected?.({
      eventName: "onPageSelected",
      nativeEvent: { position },
      position
    });
    requestAnimationFrame(() => {
      onPageScrollStateChanged?.({
        eventName: "onPageScrollStateChanged",
        nativeEvent: { pageScrollState: "idle" },
        pageScrollState: "idle"
      });
    });
  }, [onPageScroll, onPageScrollStateChanged, onPageSelected, pages.length]);

  const setPage = useCallback((nextPage: number) => {
    const clamped = clampPage(nextPage, pages.length);
    setPageState(clamped);
    emitPage(clamped);
  }, [emitPage, pages.length]);

  useImperativeHandle(ref, () => ({
    setPage,
    setPageWithoutAnimation: setPage,
    setScrollEnabled(enabled: boolean) {
      scrollEnabledRef.current = enabled;
    }
  }), [setPage]);

  useEffect(() => {
    setPageState((current) => clampPage(current, pages.length));
  }, [pages.length]);

  return (
    <View style={[styles.container, style]}>
      {pages.map((child, index) => (
        <View
          key={index}
          pointerEvents={index === page ? "auto" : "none"}
          style={[
            styles.page,
            index === page ? styles.activePage : styles.inactivePage
          ]}
        >
          {child}
        </View>
      ))}
    </View>
  );
});

export function usePagerView() {
  const ref = useRef<PagerViewRef>(null);
  return {
    AnimatedPagerView: PagerView,
    ref,
    setPage: (page: number) => ref.current?.setPage(page),
    setPageWithoutAnimation: (page: number) => ref.current?.setPageWithoutAnimation(page)
  };
}

export default PagerView;

const styles = StyleSheet.create({
  activePage: {
    opacity: 1,
    zIndex: 1
  },
  container: {
    flex: 1,
    overflow: "hidden"
  },
  inactivePage: {
    opacity: 0,
    zIndex: 0
  },
  page: {
    ...StyleSheet.absoluteFillObject
  }
});
