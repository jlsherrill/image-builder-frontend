import React from 'react';
import '@testing-library/jest-dom';

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import CreateImageWizard from '../../../Components/CreateImageWizard/CreateImageWizard';
import ShareImageModal from '../../../Components/ShareImageModal/ShareImageModal';
import {
  clickNext,
  getNextButton,
  renderCustomRoutesWithReduxRouter,
} from '../../testUtils';

const routes = [
  {
    path: 'insights/image-builder/*',
    element: <div />,
  },
  {
    path: 'insights/image-builder/imagewizard/:composeId?',
    element: <CreateImageWizard />,
  },
  {
    path: 'insights/image-builder/share/:composeId',
    element: <ShareImageModal />,
  },
];
jest.mock('@redhat-cloud-services/frontend-components/useChrome', () => ({
  useChrome: () => ({
    auth: {
      getUser: () => {
        return {
          identity: {
            internal: {
              org_id: 5,
            },
          },
        };
      },
    },
    isBeta: () => true,
    isProd: () => true,
    getEnvironment: () => 'prod',
  }),
}));

describe('Step Upload to Azure', () => {
  const getSourceDropdown = async () => {
    const sourceDropdown = await screen.findByRole('textbox', {
      name: /select source/i,
    });
    // Wait for isSuccess === true, dropdown is disabled while isSuccess === false
    await waitFor(() => expect(sourceDropdown).toBeEnabled());

    return sourceDropdown;
  };

  beforeAll(() => {
    // scrollTo is not defined in jsdom
    window.HTMLElement.prototype.scrollTo = function () {};
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const user = userEvent.setup();
  const setUp = async () => {
    renderCustomRoutesWithReduxRouter('imagewizard', {}, routes);
    // select aws as upload destination
    const azureTile = screen.getByTestId('upload-azure');
    azureTile.click();

    await clickNext();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Target environment - Microsoft Azure'
    );
  };

  test('azure step basics works', async () => {
    await setUp();

    expect(await getNextButton()).toHaveClass('pf-m-disabled');
    expect(screen.getByTestId('azure-radio-source')).toBeChecked();

    await user.click(screen.getByTestId('azure-radio-manual'));
    expect(screen.getByTestId('azure-radio-manual')).toBeChecked();

    expect(await getNextButton()).toHaveClass('pf-m-disabled');

    await user.type(
      screen.getByTestId('azure-tenant-id-manual'),
      'c983c2cd-94d7-44e1-9c6e-9cfa3a40995f'
    );
    await user.type(
      screen.getByTestId('azure-subscription-id-manual'),
      'f8f200aa-6234-4bfb-86c2-163d33dffc0c'
    );
    await user.type(
      screen.getByTestId('azure-resource-group-manual'),
      'testGroup'
    );

    expect(await getNextButton()).not.toHaveClass('pf-m-disabled');

    screen.getByTestId('azure-radio-source').click();

    expect(await getNextButton()).toHaveClass('pf-m-disabled');

    const sourceDropdown = await getSourceDropdown();

    // manual values should be cleared out
    expect(screen.getByTestId('azure-tenant-id-source')).toHaveValue('');
    expect(screen.getByTestId('azure-subscription-id-source')).toHaveValue('');

    sourceDropdown.click();

    const source = await screen.findByRole('option', {
      name: /azureSource1/i,
    });
    source.click();
    // wait for fetching the upload info
    await waitFor(() =>
      expect(screen.getByTestId('azure-tenant-id-source')).not.toHaveValue('')
    );

    const resourceGroupDropdown = screen.getByRole('textbox', {
      name: /select resource group/i,
    });
    await user.click(resourceGroupDropdown);
    const groups = screen.getAllByLabelText(/^Resource group/);
    expect(groups).toHaveLength(2);
    await user.click(screen.getByLabelText('Resource group myResourceGroup1'));

    expect(await getNextButton()).not.toHaveClass('pf-m-disabled');
  }, 10000);

  test('handles change of selected Source', async () => {
    setUp();

    const sourceDropdown = await getSourceDropdown();

    sourceDropdown.click();
    const source = await screen.findByRole('option', {
      name: /azureSource1/i,
    });
    source.click();
    await waitFor(() =>
      expect(screen.getByTestId('azure-tenant-id-source')).not.toHaveValue('')
    );

    sourceDropdown.click();
    const source2 = await screen.findByRole('option', {
      name: /azureSource2/i,
    });
    source2.click();
    await waitFor(() =>
      expect(screen.getByTestId('azure-tenant-id-source')).toHaveValue(
        '73d5694c-7a28-417e-9fca-55840084f508'
      )
    );

    const resourceGroupDropdown = screen.getByRole('textbox', {
      name: /select resource group/i,
    });
    await user.click(resourceGroupDropdown);
    const groups = screen.getByLabelText(/^Resource group/);
    expect(groups).toBeInTheDocument();
    expect(screen.getByLabelText('Resource group theirGroup2')).toBeVisible();
  });
  // set test timeout on 10 seconds
}, 15000);
