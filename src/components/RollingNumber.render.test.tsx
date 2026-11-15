import { describe, expect, it } from '@jest/globals';
import { Animated, Text } from 'react-native';
import { render } from '@testing-library/react-native';

import { RollingNumber, RollingPhrase } from './RollingNumber';

/**
 * The focus-mode report that made this suite: tap + fast through 9 → 10 and a
 * digit stopped halfway, half of one numeral over half of another.
 *
 * Since the calm pass the number no longer rolls, so the guarantee is simpler and
 * stricter: after ANY sequence of changes — fast taps, a size change in the same
 * render — what is drawn is the current value, whole, with nothing in flight.
 */

/** Every string the number draws, joined. */
function drawn(view: ReturnType<typeof render>): string {
  return view
    .UNSAFE_queryAllByType(Text)
    .map((node) => [node.props.children].flat().join(''))
    .join('');
}

describe('a number that changes in place', () => {
  it('9 → 10 → 11 at a new size draws the latest value, at once', () => {
    const view = render(<RollingNumber value="8" lineHeight={92} duration={450} />);
    view.rerender(<RollingNumber value="9" lineHeight={92} duration={450} />);
    view.rerender(<RollingNumber value="10" lineHeight={81} duration={450} />);
    view.rerender(<RollingNumber value="11" lineHeight={81} duration={450} />);
    expect(drawn(view)).toBe('11');
  });

  it('a burst of taps lands on the last value, not an earlier one', () => {
    const view = render(<RollingNumber value="1" lineHeight={60} />);
    for (const v of ['2', '3', '4', '5', '6']) {
      view.rerender(<RollingNumber value={v} lineHeight={60} />);
    }
    expect(drawn(view)).toBe('6');
  });

  it('nothing is animated — no column can be left between two cells', () => {
    const view = render(<RollingNumber value="10" lineHeight={81} />);
    view.rerender(<RollingNumber value="9" lineHeight={92} />);
    expect(view.UNSAFE_queryAllByType(Animated.View)).toHaveLength(0);
    expect(drawn(view)).toBe('9');
  });

  it('keeps separators and the spoken label', () => {
    const view = render(<RollingNumber value="1:05" lineHeight={60} />);
    expect(drawn(view)).toBe('1:05');
    expect(view.getByLabelText('1:05')).toBeTruthy();
  });

  it('a phrase fills its holes in the translated order', () => {
    const view = render(
      <RollingPhrase template="{done} of 17 sets" values={{ done: 3 }} lineHeight={20} />,
    );
    expect(drawn(view)).toBe('3 of 17 sets');
  });
});
