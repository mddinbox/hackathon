/** Shared chrome: the brand mark, a quick scenario picker, and the secondary control. */
import { MENU_EXAMPLES } from './demoExamples';
import { h } from './dom';
import type { ViewContext } from './state';

/**
 * A themed "try a wired scenario" dropdown. A native <select> renders an
 * unstyled white popup on this dark theme, so this is a small custom disclosure:
 * a trigger button and an absolutely-positioned listbox, grouped by mode,
 * closing on selection, outside-click or Escape. Open/closed state is local DOM
 * (opening is not an app action), so it never forces a re-render.
 */
function scenarioMenu(ctx: ViewContext): HTMLElement {
  const groups: string[] = [];
  for (const example of MENU_EXAMPLES) {
    if (!groups.includes(example.group)) groups.push(example.group);
  }

  const list = h(
    'div',
    { class: 'scenario-menu-list', role: 'listbox', 'aria-label': 'Wired scenarios' },
    groups.flatMap((group) => [
      h('p', { class: 'scenario-menu-group' }, [group]),
      ...MENU_EXAMPLES.filter((example) => example.group === group).map((example) => {
        const item = h(
          'button',
          {
            type: 'button',
            role: 'option',
            class: 'scenario-menu-item',
            'data-node': `scenario-menu-item-${example.scenarioId}`
          },
          [
            h('span', { class: 'scenario-menu-item-label' }, [example.label]),
            h('span', { class: 'scenario-menu-item-prompt' }, [example.prompt])
          ]
        );
        item.addEventListener('click', () => {
          close();
          void ctx.actions.ask(example.prompt);
        });
        return item;
      })
    ])
  );
  list.hidden = true;

  const button = h(
    'button',
    {
      type: 'button',
      class: 'scenario-menu-button',
      'data-node': 'scenario-menu',
      'aria-haspopup': 'listbox',
      'aria-expanded': 'false'
    },
    [h('span', {}, ['Try a scenario']), h('span', { class: 'scenario-menu-caret', 'aria-hidden': 'true' }, ['▾'])]
  );

  const wrap = h('div', { class: 'scenario-menu', 'data-node': 'scenario-menu-wrap' }, [button, list]);

  function onDocClick(event: MouseEvent): void {
    if (!wrap.contains(event.target as Node)) close();
  }
  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      close();
      button.focus();
    }
  }
  function open(): void {
    list.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    setTimeout(() => document.addEventListener('click', onDocClick));
    document.addEventListener('keydown', onKey);
  }
  function close(): void {
    if (list.hidden) return;
    list.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', onDocClick);
    document.removeEventListener('keydown', onKey);
  }
  button.addEventListener('click', () => {
    if (list.hidden) open();
    else close();
  });

  return wrap;
}

export function brandRow(ctx: ViewContext, tone: 'home' | 'world'): HTMLElement {
  const brand = h(
    'button',
    {
      type: 'button',
      class: 'brand',
      'data-node': 'brand',
      'aria-label': 'CanvasBrowser — back to home'
    },
    [
      h('span', { class: 'brand-mark', 'aria-hidden': 'true' }),
      h('span', { class: 'brand-word' }, ['CanvasBrowser'])
    ]
  );
  brand.addEventListener('click', () => ctx.actions.backHome());

  const more = h(
    'button',
    {
      type: 'button',
      class: 'ghost-button',
      'data-node': 'more-button',
      'aria-haspopup': 'dialog',
      'aria-expanded': ctx.state.moreOpen ? 'true' : 'false'
    },
    ['More']
  );
  more.addEventListener('click', () => ctx.actions.openMore());

  return h('header', { class: `brand-row brand-row--${tone}` }, [
    brand,
    h('div', { class: 'brand-actions' }, [tone === 'home' ? scenarioMenu(ctx) : null, more])
  ]);
}
