import { render, screen } from '@testing-library/react';
import App from './App';

test('renders the MMU Parser header', () => {
  render(<App />);
  expect(
    screen.getByRole('heading', { name: /mmu parser/i })
  ).toBeInTheDocument();
});
