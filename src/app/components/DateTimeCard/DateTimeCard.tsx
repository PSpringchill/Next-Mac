import React, { useState, useEffect } from 'react';
import dayjs from 'dayjs';

const DateTimeCard: React.FC = () => {
  const [dateTime, setDateTime] = useState<Date>(new Date());
  const [displayMode, setDisplayMode] = useState<'number' | 'roman'>('number');

  const toRoman = (num: number): string => {
    const romanNumerals: { [key: number]: string } = {
      1: 'I', 4: 'IV', 5: 'V', 9: 'IX', 10: 'X',
      40: 'XL', 50: 'L', 90: 'XC', 100: 'C',
      400: 'CD', 500: 'D', 900: 'CM', 1000: 'M'
    };

    let result = '';
    const keys = Object.keys(romanNumerals).map(Number).sort((a, b) => b - a);

    for (const intValue of keys) {
      while (num >= intValue) {
        result += romanNumerals[intValue];
        num -= intValue;
      }
    }

    return result;
  };

  const formatDate = (dateTime: Date, mode: 'number' | 'roman'): string => {
    const romanNumerals = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

    const day = mode === 'roman' ? romanNumerals[dateTime.getDate() - 1] : dateTime.getDate().toString();

    const formattedDate = dayjs(dateTime).format('ddd D MMM');

    return formattedDate.replace(/\d+/, day); // Replace the day part with the Roman numeral
  };

  const formatTimeInRoman = (dateTime: Date): string => {
    const hours = toRoman(dateTime.getHours() % 12 || 12);
    const minutes = toRoman(dateTime.getMinutes());
    const timeString = dayjs(dateTime).format('h:mm A').replace(/^0/, '');;
    return `${hours}:${minutes.padStart(2, '0')} ${timeString.slice(-2)}`;
  };

  const toggleDisplayMode = () => {
    setDisplayMode(prevMode => (prevMode === 'number' ? 'roman' : 'number'));
  };

  const formattedDate = displayMode === 'number' ? formatDate(dateTime, 'number') : formatDate(dateTime, 'roman');
  const formattedTime = displayMode === 'number' ? dayjs(dateTime).format('h:mm A') : formatTimeInRoman(dateTime);

  return (
    <div className="absolute font-mono right-10 p-2 text-white" onClick={toggleDisplayMode}>
      <p className="font-mono">
        <span>{formattedDate}</span>{' '}
        {formattedTime}
      </p>
    </div>
  );
};

export default DateTimeCard;
