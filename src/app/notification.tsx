import React, { useRef, useState, useMemo, useEffect } from 'react';
import { X } from 'react-feather';
import { useTransition } from '@react-spring/web';
import { Main, Container, Message, Button, Content, Life } from './styles';

let id = 0;

interface MessageHubProps {
  config?: {
    tension: number;
    friction: number;
    precision: number;
  };
  timeout?: number;
  children: (add: AddFunction) => void;
}

type AddFunction = (msg: string) => void;

interface Item {
  key: number;
  msg: string;
  autoRemove: boolean;
}

export default function MessageHub({
  config = { tension: 125, friction: 20, precision: 0.1 },
  timeout = 3000,
  children,
}: MessageHubProps) {
  const refMap = useMemo(() => new WeakMap(), []);
  const cancelMap = useMemo(() => new WeakMap(), []);
  const [items, setItems] = useState<Item[]>([]);

  const transitions = useTransition(items, {
    from: { opacity: 0, height: 0, life: '100%' },
    keys: (item) => item.key,
    enter: (item) => async (next, cancel) => {
      cancelMap.set(item, cancel);
      await next({ opacity: 1, height: refMap.get(item).offsetHeight });
      await next({ life: '0%' });
    },
    leave: [{ opacity: 0 }, { height: 0 }],
    onRest: (result, ctrl, item) => {
      if (item.autoRemove) {
        setItems((state) =>
          state.filter((i) => {
            return i.key !== item.key;
          })
        );
      }
    },
    config: (item, index, phase) =>
      phase === 'enter' && item && item.life ? { duration: timeout } : config,
  });

  const handleButtonClick = (item: Item) => {
    if (cancelMap.has(item)) {
      cancelMap.get(item)();
    }
    setItems((state) => state.filter((i) => i.key !== item.key));
  };

  const handleMessageClick = (item: Item) => {
    setItems((state) =>
      state.map((i) =>
        i.key === item.key ? { ...i, autoRemove: true } : { ...i }
      )
    );
  };

  useEffect(() => {
    children((msg: string) => {
      setItems((state) => [...state, { key: id++, msg, autoRemove: false }]);
    });
  }, []);

  return (
    <Container>
      {transitions(({ life, ...style }, item) => (
        <Message
          style={style}
          onClick={() => handleMessageClick(item)}
          autoRemove={item.autoRemove}
        >
          <Content ref={(ref: HTMLDivElement) => ref && refMap.set(item, ref)}>
            <Life style={{ right: life }} />
            <p className="p-0 mb-3" >{item.msg}</p>
            <Button onClick={() => handleButtonClick(item)}>
              <X size={18} />
            </Button>
          </Content>
        </Message>
      ))}
    </Container>
  );
}
