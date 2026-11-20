/**
 * AiOrderList — a whole new order the assistant suggested, drawn as the list
 * itself, and still draggable.
 *
 *   EXERCISE ORDER
 *   ⠿ 1  Squat
 *   ⠿ 2  Bench press          ← hold, then slide
 *   ⠿ 3  Row
 *   Hold a row, then slide it to change the order.
 *
 * ── WHY THE CARD IS THE EDITOR HERE, WHEN NOWHERE ELSE IT IS ───────────────
 *
 * `AiChangesCard` applies a card whole and refuses to be a second editor for
 * fields that already have one. An order is the exception because of how it
 * goes wrong: the model gets ONE row in the wrong place, and the only ways to fix
 * that were to ask again (and get a different wrong row) or to Apply and then go
 * and drag it in the right screen. Letting the rows move here — with the very
 * gesture the routine editor, the Sequence screen and the session use
 * (`useDragReorder` + `ReorderRow`) — makes the card a preview the user corrects,
 * and Apply writes what they see. Nothing is written by a drag: it changes the
 * card's pending order (`aiStore.setChangeOrder`), which survives a restart like
 * the rest of the chat.
 *
 * ── THE CHAT MUST NOT SCROLL UNDER THE FINGER ─────────────────────────────
 *
 * As on every other drag list, the ScrollView stops scrolling while a row is in
 * the air: `onDragging` tells the chat, which turns `scrollEnabled` off (and
 * scrolls FOR the user at the edges through `autoScroll`, when it passes one).
 * A row released without moving stays lifted — the hook's MODE, not a gesture —
 * so `Drop` sits above the list as the way out, where the screens put it in
 * their headers.
 *
 * Once the card is applied or discarded the list is drawn still, in the order
 * that was applied, with no grip: there is nothing left to move.
 */

import { useCallback, useEffect, useRef } from 'react';
import { Text, View, type AccessibilityActionEvent } from 'react-native';

import { Icon } from './Icon';
import { Pressable } from './Pressable';
import { ReorderRow } from './ReorderRow';
import { pressedStyle } from './motion';
import { useT } from '../hooks/useT';
import { useDragReorder, type CardLayout, type DragAutoScroll } from '../hooks/useDragReorder';
import { moveKey, orderedRows, type OrderRow } from '../lib/ai/aiOrder';
import { palette, radius } from '../theme/tokens';

export function AiOrderList({
  rows,
  order,
  editable,
  onReorder,
  onDragging,
  autoScroll,
}: {
  /** The change's rows — every key the order may hold. */
  rows: readonly OrderRow[];
  /** The pending order, as keys. */
  order: readonly string[];
  /** The card is pending: rows can be dragged. */
  editable: boolean;
  onReorder: (order: string[]) => void;
  /** A row went up (true) or came down (false) — the chat stops scrolling meanwhile. */
  onDragging?: (dragging: boolean) => void;
  autoScroll?: DragAutoScroll;
}) {
  const t = useT();
  const drawn = orderedRows({ rows: [...rows], order: [...order] });
  const keys = drawn.map((r) => r.key);

  const layouts = useRef<Record<string, CardLayout>>({});
  const move = useCallback(
    (key: string, toIndex: number) => onReorder(moveKey(keys, key, toIndex)),
    [keys, onReorder],
  );
  const { lifted, dragY, panHandlers, listRef, lift, drop, shiftFor } = useDragReorder(
    keys,
    layouts,
    move,
    autoScroll,
  );

  /* The chat hears every lift and drop — and a lift cut short by the card
     leaving the screen still has to turn its scrolling back on. */
  const onDraggingRef = useRef(onDragging);
  onDraggingRef.current = onDragging;
  useEffect(() => {
    onDraggingRef.current?.(lifted != null);
  }, [lifted]);
  useEffect(() => () => onDraggingRef.current?.(false), []);

  const canDrag = editable && keys.length > 1;
  const liftedName = drawn.find((r) => r.key === lifted)?.name ?? '';

  return (
    <View>
      {lifted ? (
        <View className="mb-xs flex-row items-center">
          <Text numberOfLines={1} className="flex-1 text-micro font-semibold text-green-bright">
            {`${t('Moving')} · ${liftedName}`}
          </Text>
          <Pressable
            onPress={drop}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('Drop')}
            style={(state) => [
              pressedStyle(state),
              {
                height: 28,
                paddingHorizontal: 12,
                borderRadius: radius.pill,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'rgba(236,241,238,0.07)',
              },
            ]}
          >
            <Text className="text-label font-semibold text-green-bright">{t('Drop')}</Text>
          </Pressable>
        </View>
      ) : null}

      <View ref={listRef} collapsable={false} {...panHandlers}>
        {drawn.map((row, index) => {
          const key = row.key;
          const isLifted = lifted === key;
          const moveOne = (event: AccessibilityActionEvent) => {
            const by = event.nativeEvent.actionName === 'moveUp' ? -1 : 1;
            const to = index + by;
            if (to >= 0 && to < keys.length) onReorder(moveKey(keys, key, to));
          };
          return (
            <ReorderRow
              key={key}
              lifted={isLifted}
              dragging={lifted != null}
              dragY={dragY}
              shift={shiftFor(key)}
              onLayout={(e) => {
                const { y, height } = e.nativeEvent.layout;
                layouts.current[key] = { y, height };
              }}
            >
              <Pressable
                onLongPress={canDrag ? () => lift(key) : undefined}
                delayLongPress={200}
                disabled={!canDrag}
                accessibilityRole={canDrag ? 'adjustable' : undefined}
                accessibilityLabel={`${index + 1}. ${row.name}`}
                accessibilityHint={canDrag ? t('Long press, then slide to reorder') : undefined}
                accessibilityActions={
                  canDrag
                    ? [
                        ...(index > 0 ? [{ name: 'moveUp', label: t('Move up') }] : []),
                        ...(index < keys.length - 1
                          ? [{ name: 'moveDown', label: t('Move down') }]
                          : []),
                      ]
                    : undefined
                }
                onAccessibilityAction={canDrag ? moveOne : undefined}
                style={{
                  minHeight: 44,
                  flexDirection: 'row',
                  alignItems: 'center',
                  borderRadius: radius.row,
                  borderWidth: 1,
                  borderColor: isLifted ? palette.greenBright : 'transparent',
                  backgroundColor: isLifted ? 'rgba(236,241,238,0.10)' : 'transparent',
                  opacity: lifted != null && !isLifted ? 0.5 : 1,
                }}
              >
                {canDrag ? (
                  <View style={{ width: 28, alignItems: 'center' }}>
                    <Icon
                      name="grip"
                      size={14}
                      color={isLifted ? palette.greenBright : palette.inkFaint}
                    />
                  </View>
                ) : null}
                <Text
                  className="text-label tabular-nums text-ink-faint"
                  style={{ width: 22, textAlign: 'right', marginRight: 10 }}
                >
                  {index + 1}
                </Text>
                <Text numberOfLines={1} className="flex-1 text-label font-medium text-ink">
                  {row.name}
                </Text>
              </Pressable>
            </ReorderRow>
          );
        })}
      </View>

      {canDrag && !lifted ? (
        <Text className="mt-xs text-micro text-ink-faint">
          {t('Hold a row, then slide it to change the order.')}
        </Text>
      ) : null}
    </View>
  );
}
