import React from 'react';

export interface ButtonProps {
  label: string;
}

export function PrimaryButton(props: ButtonProps) {
  return <button>{props.label}</button>;
}
