import * as React from 'react'
import { animated, useSpringValue } from '@react-spring/web'
import { clamp } from '@react-spring/shared'

import { useWindowResize } from '../hooks/useWindowResize'

import { DockContext } from './DockContext'

import styles from './styles.module.scss'

interface DockProps {
  children: React.ReactNode
}

export const DOCK_ZOOM_LIMIT = [-100, 50]

export const Dock = ({ children }: DockProps) => {
  const [hovered, setHovered] = React.useState(false)
  const [width, setWidth] = React.useState(0)
  const isZooming = React.useRef(false)
  const dockRef = React.useRef<HTMLDivElement>(null!)

  const setIsZooming = React.useCallback((value: boolean) => {
    isZooming.current = value
    setHovered(!value)
  }, [])

  const zoomLevel = useSpringValue(1, {
    onChange: () => {
      setWidth(dockRef.current?.clientWidth || 0);
    },
  })

  useWindowResize(() => {
    setWidth(dockRef.current?.clientWidth || 0);
  })

  return (
    <DockContext.Provider value={{ hovered, setIsZooming, width, zoomLevel }}>
      <animated.div
        ref={dockRef}
        className={styles.dock}
        onMouseOver={() => {
          if (!isZooming.current) {
            setHovered(true);
            zoomLevel.set(2.5); // Adjust zoom level on hover
          }
        }}
        onMouseOut={() => {
          setHovered(false);
          zoomLevel.set(1); // Reset zoom level on mouse out
        }}
        style={{
          x: '-50%',
          scale: zoomLevel
            .to({
              range: [DOCK_ZOOM_LIMIT[0], 1, DOCK_ZOOM_LIMIT[1]],
              output: [2, 1, 0.5],
            })
            .to(value => clamp(0.5, 2, value)),
        }}>
        {children}
      </animated.div>
    </DockContext.Provider>
  )
}
