import { test, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

test('guided repairs run real analysis through four, two, one and zero risks', async ({page}) => {
  await page.goto('./');
  await page.getByRole('button', {name:'Start with sample specs'}).click();
  await expect(page.locator('#challenge-progress')).toContainText('0 of 3 repairs verified · 4 breaking');
  for (const [button, remaining] of [['Repair enum contracts','2'], ['Restore required field','1'], ['Restore deleted endpoint','0']]) {
    await page.getByRole('button',{name:button, exact:true}).click();
    await expect(page.locator('#breaking-count')).toHaveText(remaining);
  }
  await expect(page.locator('#challenge-step')).toContainText('Challenge complete');
  await expect(page.locator('#challenge-progress')).toContainText('3 of 3 repairs verified');
  const candidate = JSON.parse(await page.locator('#candidate').inputValue());
  expect(candidate.info.version).toBe('2.0.0');
  expect(candidate.paths['/parcels/{id}'].delete).toBeDefined();
  await expect(page.getByRole('button',{name:'Download JSON'})).toBeEnabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  await page.getByRole('button',{name:'Restart with sample specs'}).click();
  await expect(page.locator('#breaking-count')).toHaveText('4');
  await expect(page.locator('#challenge-progress')).toContainText('0 of 3 repairs verified');
});

test('manual input changes leave the exercise without overwriting user work', async ({page}) => {
  await page.goto('./');
  await page.getByRole('button',{name:'Start with sample specs'}).click();
  await expect(page.getByRole('button',{name:'Repair enum contracts'})).toBeEnabled();
  await page.getByRole('textbox',{name:'Candidate',exact:true}).fill('{custom input');
  await expect(page.locator('#challenge-progress')).toContainText('Manual editing paused');
  await expect(page.getByRole('button',{name:'Repair enum contracts'})).toBeHidden();
  await expect(page.getByRole('textbox',{name:'Candidate',exact:true})).toHaveValue('{custom input');
  await expect(page.getByRole('button',{name:'Download JSON'})).toBeDisabled();
});
