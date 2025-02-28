import React from 'react';

import '@testing-library/jest-dom';

import {
  act,
  screen,
  waitFor,
  waitForElementToBeRemoved,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { rest } from 'msw';

import api from '../../../api.js';
import CreateImageWizard from '../../../Components/CreateImageWizard/CreateImageWizard';
import ShareImageModal from '../../../Components/ShareImageModal/ShareImageModal';
import { RHEL_8, RHEL_9, PROVISIONING_API } from '../../../constants.js';
import { mockComposesEmpty } from '../../fixtures/composes';
import { customizations, ids } from '../../fixtures/customizations';
import { mockPkgResultAlphaContentSources } from '../../fixtures/packages';
import { server } from '../../mocks/server.js';
import {
  clickBack,
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

let store = undefined;
let router = undefined;

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

// Mocking getComposes is necessary because in many tests we call navigate()
// to navigate to the images table (via useNavigate hook), which will in turn
// result in a call to getComposes. If it is not mocked, tests fail due to MSW
// being unable to resolve that endpoint.
jest
  .spyOn(api, 'getComposes')
  .mockImplementation(() => Promise.resolve(mockComposesEmpty));

const searchForAvailablePackages = async (searchbox, searchTerm) => {
  const user = userEvent.setup();
  await user.type(searchbox, searchTerm);
  await act(async () => {
    screen
      .getByRole('button', { name: /search button for available packages/i })
      .click();
  });
};

const searchForChosenPackages = async (searchbox, searchTerm) => {
  const user = userEvent.setup();
  if (!searchTerm) {
    await user.clear(searchbox);
  } else {
    await user.type(searchbox, searchTerm);
  }
};

beforeAll(() => {
  // scrollTo is not defined in jsdom
  window.HTMLElement.prototype.scrollTo = function () {};
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('Create Image Wizard', () => {
  test('renders component', () => {
    renderCustomRoutesWithReduxRouter('imagewizard', {}, routes);
    // check heading
    screen.getByRole('heading', { name: /Create image/ });

    screen.getByRole('button', { name: 'Image output' });
    screen.getByRole('button', { name: 'Register' });
    screen.getByRole('button', { name: 'File system configuration' });
    screen.getByRole('button', { name: 'Content' });
    screen.getByRole('button', { name: 'Additional Red Hat packages' });
    screen.getByRole('button', { name: 'Custom repositories' });
    screen.getByRole('button', { name: 'Details' });
    screen.getByRole('button', { name: 'Review' });
  });
});

describe('Step Upload to AWS', () => {
  const user = userEvent.setup();
  const setUp = async () => {
    ({ router, store } = renderCustomRoutesWithReduxRouter(
      'imagewizard',
      {},
      routes
    ));

    // select aws as upload destination
    const awsTile = await screen.findByTestId('upload-aws');
    await act(async () => {
      awsTile.click();
    });

    await clickNext();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Target environment - Amazon Web Services'
    );
  };

  test('component renders error state correctly', async () => {
    await setUp();
    server.use(
      rest.get(`${PROVISIONING_API}/sources`, (_req, res, ctx) =>
        res(ctx.status(500))
      )
    );

    await screen.findByText(
      /sources cannot be reached, try again later or enter an aws account id manually\./i
    );
  });

  test('validation works', async () => {
    await setUp();

    // jsdom seems to render the next button differently than the browser. The
    // next button is enabled briefly during the test. This does not occur in
    // the browser. Using findByRole instead of getByRole to get the next
    // button allows us to capture its 'final' state.
    expect(await getNextButton()).toHaveClass('pf-m-disabled');

    await user.click(
      screen.getByRole('radio', { name: /manually enter an account id\./i })
    );

    expect(await getNextButton()).toHaveClass('pf-m-disabled');

    await user.type(screen.getByTestId('aws-account-id'), '012345678901');

    expect(await getNextButton()).not.toHaveClass('pf-m-disabled');

    screen
      .getByRole('radio', { name: /use an account configured from sources\./i })
      .click();

    expect(await getNextButton()).toHaveClass('pf-m-disabled');

    const sourceDropdown = screen.getByRole('textbox', {
      name: /select source/i,
    });
    // Wait for isSuccess === true, dropdown is disabled while isSuccess === false
    await waitFor(() => expect(sourceDropdown).toBeEnabled());
    sourceDropdown.click();

    const source = await screen.findByRole('option', {
      name: /my_source/i,
    });
    source.click();

    expect(await getNextButton()).not.toHaveClass('pf-m-disabled');
  });

  test('compose request share_with_sources field is correct', async () => {
    await setUp();

    const sourceDropdown = await screen.findByRole('textbox', {
      name: /select source/i,
    });
    // Wait for isSuccess === true, dropdown is disabled while isSuccess === false
    await waitFor(() => expect(sourceDropdown).toBeEnabled());
    await act(async () => {
      sourceDropdown.click();
    });

    const source = await screen.findByRole('option', {
      name: /my_source/i,
    });
    await act(async () => {
      source.click();
    });

    await act(async () => {
      await clickNext();
    });

    // registration
    await screen.findByRole('textbox', {
      name: 'Select activation key',
    });

    const registerLaterRadio = screen.getByLabelText('Register later');
    await act(async () => {
      await user.click(registerLaterRadio);
    });

    // click through to review step
    await act(async () => {
      await clickNext();
      await clickNext();
      await clickNext();
      await clickNext();
      await clickNext();
    });

    const composeImage = jest
      .spyOn(api, 'composeImage')
      .mockImplementation((body) => {
        expect(body).toEqual({
          distribution: RHEL_9,
          image_name: undefined,
          customizations: {
            packages: undefined,
          },
          image_requests: [
            {
              architecture: 'x86_64',
              image_type: 'aws',
              upload_request: {
                type: 'aws',
                options: {
                  share_with_sources: ['123'],
                },
              },
            },
          ],
        });
        const id = 'edbae1c2-62bc-42c1-ae0c-3110ab718f5a';
        return Promise.resolve({ id });
      });

    const create = screen.getByRole('button', { name: /Create/ });
    await act(async () => {
      create.click();
    });

    // API request sent to backend
    expect(composeImage).toHaveBeenCalledTimes(1);

    // returns back to the landing page
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/insights/image-builder')
    );
    expect(store.getState().composes.allIds).toEqual([
      'edbae1c2-62bc-42c1-ae0c-3110ab718f5a',
    ]);
    // set test timeout of 10 seconds
  }, 10000);
});

describe('Step Packages', () => {
  const user = userEvent.setup();
  const setUp = async () => {
    ({ router } = renderCustomRoutesWithReduxRouter('imagewizard', {}, routes));

    // select aws as upload destination
    const awsTile = screen.getByTestId('upload-aws');
    await act(async () => {
      awsTile.click();
      await clickNext();
    });

    // aws step
    await user.click(
      screen.getByRole('radio', { name: /manually enter an account id\./i })
    );
    await user.type(screen.getByTestId('aws-account-id'), '012345678901');
    await act(async () => {
      await clickNext();
    });
    // skip registration
    await screen.findByRole('textbox', {
      name: 'Select activation key',
    });

    const registerLaterRadio = screen.getByTestId('registration-radio-later');
    await user.click(registerLaterRadio);
    await act(async () => {
      await clickNext();

      // skip fsc
      await clickNext();
    });
  };

  test('search results should be sorted with most relevant results first', async () => {
    await setUp();

    const view = await screen.findByTestId('search-available-pkgs-input');

    const searchbox = within(view).getByRole('textbox', {
      name: /search input/i,
    });

    //const searchbox = screen.getAllByRole('textbox')[0]; // searching by id doesn't update the input ref

    await waitFor(() => expect(searchbox).toBeEnabled());
    await act(async () => {
      searchbox.click();
    });

    await searchForAvailablePackages(searchbox, 'test');

    const availablePackagesList = await screen.findByTestId(
      'available-pkgs-list'
    );
    const availablePackagesItems = await within(
      availablePackagesList
    ).findAllByRole('option');
    expect(availablePackagesItems).toHaveLength(3);
    const [firstItem, secondItem, thirdItem] = availablePackagesItems;
    expect(firstItem).toHaveTextContent('testsummary for test package');
    expect(secondItem).toHaveTextContent('testPkgtest package summary');
    expect(thirdItem).toHaveTextContent('lib-testlib-test package summary');
  });

  test('search results should be sorted after selecting them and then deselecting them', async () => {
    await setUp();

    const searchbox = screen.getAllByRole('textbox')[0]; // searching by id doesn't update the input ref

    await waitFor(() => expect(searchbox).toBeEnabled());
    await act(async () => {
      searchbox.click();
    });

    await searchForAvailablePackages(searchbox, 'test');

    screen.getByTestId('available-pkgs-testPkg').click();
    screen.getByRole('button', { name: /Add selected/ }).click();

    screen.getByTestId('selected-pkgs-testPkg').click();
    screen.getByRole('button', { name: /Remove selected/ }).click();

    const availablePackagesList = screen.getByTestId('available-pkgs-list');
    const availablePackagesItems = within(availablePackagesList).getAllByRole(
      'option'
    );
    expect(availablePackagesItems).toHaveLength(3);
    const [firstItem, secondItem, thirdItem] = availablePackagesItems;
    expect(firstItem).toHaveTextContent('testsummary for test package');
    expect(secondItem).toHaveTextContent('testPkgtest package summary');
    expect(thirdItem).toHaveTextContent('lib-testlib-test package summary');
  });

  test('search results should be sorted after adding and then removing all packages', async () => {
    await setUp();

    const searchbox = screen.getAllByRole('textbox')[0]; // searching by id doesn't update the input ref

    await waitFor(() => expect(searchbox).toBeEnabled());
    searchbox.click();

    await searchForAvailablePackages(searchbox, 'test');

    screen.getByRole('button', { name: /Add all/ }).click();
    screen.getByRole('button', { name: /Remove all/ }).click();

    const availablePackagesList = screen.getByTestId('available-pkgs-list');
    const availablePackagesItems = within(availablePackagesList).getAllByRole(
      'option'
    );
    expect(availablePackagesItems).toHaveLength(3);
    const [firstItem, secondItem, thirdItem] = availablePackagesItems;
    expect(firstItem).toHaveTextContent('testsummary for test package');
    expect(secondItem).toHaveTextContent('testPkgtest package summary');
    expect(thirdItem).toHaveTextContent('lib-testlib-test package summary');
  });

  test('removing a single package updates the state correctly', async () => {
    await setUp();

    const searchbox = screen.getAllByRole('textbox')[0]; // searching by id doesn't update the input ref

    await waitFor(() => expect(searchbox).toBeEnabled());
    searchbox.click();

    await searchForAvailablePackages(searchbox, 'test');
    screen.getByRole('button', { name: /Add all/ }).click();

    // remove a single package
    screen.getByTestId('selected-pkgs-lib-test').click();
    screen.getByRole('button', { name: /Remove selected/ }).click();
    // skip Custom repositories page
    screen.getByRole('button', { name: /Next/ }).click();

    // skip name page
    screen.getByRole('button', { name: /Next/ }).click();

    // review page
    screen.getByRole('button', { name: /Next/ }).click();

    // await screen.findByTestId('chosen-packages-count');
    const chosen = await screen.findByTestId('chosen-packages-count');
    expect(chosen).toHaveTextContent('2');
  });

  test('should display empty available state on failed search', async () => {
    await setUp();

    const searchbox = screen.getAllByRole('textbox')[0]; // searching by id doesn't update the input ref

    await waitFor(() => expect(searchbox).toBeEnabled());
    searchbox.click();

    await searchForAvailablePackages(searchbox, 'asdf');

    await screen.findByText('No results found');
  });

  test('should display empty chosen state on failed search', async () => {
    await setUp();

    const searchboxAvailable = screen.getAllByRole('textbox')[0]; // searching by id doesn't update the input ref
    const searchboxChosen = screen.getAllByRole('textbox')[1];

    await waitFor(() => expect(searchboxAvailable).toBeEnabled());
    searchboxAvailable.click();
    await searchForAvailablePackages(searchboxAvailable, 'test');

    screen.getByRole('button', { name: /Add all/ }).click();

    searchboxChosen.click();
    await user.type(searchboxChosen, 'asdf');

    expect(screen.getAllByText('No packages found').length === 2);
    // We need to clear this input in order to not have sideeffects on other tests
    await searchForChosenPackages(searchboxChosen, '');
  });

  test('search results should be sorted alphabetically', async () => {
    await setUp();

    const searchbox = screen.getAllByRole('textbox')[0]; // searching by id doesn't update the input ref

    await waitFor(() => expect(searchbox).toBeEnabled());
    searchbox.click();

    const getPackages = jest
      .spyOn(api, 'getPackagesContentSources')
      .mockImplementation(() =>
        Promise.resolve(mockPkgResultAlphaContentSources)
      );

    await searchForAvailablePackages(searchbox, 'test');
    expect(getPackages).toHaveBeenCalledTimes(1);

    const availablePackagesList = screen.getByTestId('available-pkgs-list');
    const availablePackagesItems = within(availablePackagesList).getAllByRole(
      'option'
    );
    expect(availablePackagesItems).toHaveLength(3);

    const [firstItem, secondItem, thirdItem] = availablePackagesItems;
    expect(firstItem).toHaveTextContent('testsummary for test package');
    expect(secondItem).toHaveTextContent('lib-testlib-test package summary');
    expect(thirdItem).toHaveTextContent('Z-testZ-test package summary');
  });

  test('available packages can be reset', async () => {
    await setUp();

    const searchbox = screen.getAllByRole('textbox')[0];

    await waitFor(() => expect(searchbox).toBeEnabled());
    searchbox.click();

    await searchForAvailablePackages(searchbox, 'test');

    const availablePackagesList = screen.getByTestId('available-pkgs-list');
    const availablePackagesItems = within(availablePackagesList).getAllByRole(
      'option'
    );
    expect(availablePackagesItems).toHaveLength(3);

    screen
      .getByRole('button', { name: /clear available packages search/i })
      .click();

    screen.getByText('Search above to add additionalpackages to your image');
  });

  test('chosen packages can be reset after filtering', async () => {
    await setUp();

    const availableSearchbox = screen.getAllByRole('textbox')[0];

    await waitFor(() => expect(availableSearchbox).toBeEnabled());
    availableSearchbox.click();

    await searchForAvailablePackages(availableSearchbox, 'test');

    const availablePackagesList = screen.getByTestId('available-pkgs-list');
    const availablePackagesItems = within(availablePackagesList).getAllByRole(
      'option'
    );
    expect(availablePackagesItems).toHaveLength(3);

    screen.getByRole('button', { name: /Add all/ }).click();

    const chosenPackagesList = screen.getByTestId('chosen-pkgs-list');
    let chosenPackagesItems = within(chosenPackagesList).getAllByRole('option');
    expect(chosenPackagesItems).toHaveLength(3);

    const chosenSearchbox = screen.getAllByRole('textbox')[1];
    chosenSearchbox.click();
    await searchForChosenPackages(chosenSearchbox, 'lib');
    chosenPackagesItems = within(chosenPackagesList).getAllByRole('option');
    // eslint-disable-next-line jest-dom/prefer-in-document
    expect(chosenPackagesItems).toHaveLength(1);

    screen
      .getByRole('button', { name: /clear chosen packages search/i })
      .click();
    chosenPackagesItems = within(chosenPackagesList).getAllByRole('option');
    expect(chosenPackagesItems).toHaveLength(3);
  });
});

describe('Step Custom repositories', () => {
  const user = userEvent.setup();
  const setUp = async () => {
    ({ router } = renderCustomRoutesWithReduxRouter('imagewizard', {}, routes));

    // select aws as upload destination
    const awsTile = screen.getByTestId('upload-aws');
    await act(async () => {
      awsTile.click();
      await clickNext();
    });

    // aws step
    await user.click(
      screen.getByRole('radio', { name: /manually enter an account id\./i })
    );
    await user.type(screen.getByTestId('aws-account-id'), '012345678901');
    await act(async () => {
      await clickNext();
    });
    // skip registration
    await screen.findByRole('textbox', {
      name: 'Select activation key',
    });

    const registerLaterRadio = screen.getByLabelText('Register later');
    await user.click(registerLaterRadio);
    await act(async () => {
      await clickNext();

      // skip fsc
      await clickNext();

      // skip packages
      await clickNext();
    });
  };

  test('selected repositories stored in and retrieved from form state', async () => {
    await setUp();

    const getFirstRepoCheckbox = () =>
      screen.findByRole('checkbox', {
        name: /select row 0/i,
      });
    let firstRepoCheckbox = await getFirstRepoCheckbox();

    expect(firstRepoCheckbox.checked).toEqual(false);
    await user.click(firstRepoCheckbox);
    expect(firstRepoCheckbox.checked).toEqual(true);

    await act(async () => {
      await clickNext();
      clickBack();
    });

    firstRepoCheckbox = await getFirstRepoCheckbox();
    expect(firstRepoCheckbox.checked).toEqual(true);
  });

  test('correct number of repositories is fetched', async () => {
    await setUp();

    const selectButton = await screen.findByRole('button', {
      name: /select/i,
    });
    await user.click(selectButton);

    screen.getByText(/select all \(1015 items\)/i);
  });

  test('filter works', async () => {
    await setUp();

    await user.type(
      await screen.findByRole('textbox', { name: /search repositories/i }),
      '2zmya'
    );

    const table = await screen.findByTestId('repositories-table');
    const { getAllByRole } = within(table);
    const getRows = () => getAllByRole('row');

    let rows = getRows();
    // remove first row from list since it is just header labels
    rows.shift();

    expect(rows).toHaveLength(1);

    // clear filter
    screen.getByRole('button', { name: /reset/i }).click();

    rows = getRows();
    // remove first row from list since it is just header labels
    rows.shift();

    expect(rows).toHaveLength(10);
  });
});

describe('Click through all steps', () => {
  const user = userEvent.setup();

  const setUp = async () => {
    ({ router, store } = renderCustomRoutesWithReduxRouter(
      'imagewizard',
      {},
      routes
    ));
  };

  test('with valid values', async () => {
    await setUp();

    // select image output
    const releaseMenu = screen.getByRole('button', {
      name: /options menu/i,
    });
    await user.click(releaseMenu);
    const releaseOption = screen.getByRole('option', {
      name: 'Red Hat Enterprise Linux (RHEL) 8',
    });
    await user.click(releaseOption);

    await user.click(screen.getByTestId('upload-aws'));
    await user.click(screen.getByTestId('upload-azure'));
    await user.click(screen.getByTestId('upload-google'));
    await user.click(screen.getByTestId('checkbox-vmware'));
    await user.click(screen.getByTestId('checkbox-guest-image'));
    await user.click(screen.getByTestId('checkbox-image-installer'));

    screen.getByRole('button', { name: /Next/ }).click();
    await user.click(
      screen.getByRole('radio', { name: /manually enter an account id\./i })
    );
    await user.type(screen.getByTestId('aws-account-id'), '012345678901');
    const bn1 = screen.getByRole('button', { name: /Next/ });
    await act(async () => {
      bn1.click();
    });

    await user.type(screen.getByTestId('input-google-email'), 'test@test.com');
    const bn2 = screen.getByRole('button', { name: /Next/ });
    await act(async () => {
      bn2.click();
    });

    const azm = screen.getByTestId('azure-radio-manual');
    await act(async () => {
      azm.click();
    });
    // Randomly generated GUID
    await user.type(
      screen.getByTestId('azure-tenant-id-manual'),
      'b8f86d22-4371-46ce-95e7-65c415f3b1e2'
    );
    await user.type(
      screen.getByTestId('azure-subscription-id-manual'),
      '60631143-a7dc-4d15-988b-ba83f3c99711'
    );
    await user.type(
      screen.getByTestId('azure-resource-group-manual'),
      'testResourceGroup'
    );
    const bn4 = screen.getByRole('button', { name: /Next/ });
    await act(async () => {
      bn4.click();
    });

    // registration
    const activationKeyDropdown = await screen.findByRole('textbox', {
      name: 'Select activation key',
    });
    await user.click(activationKeyDropdown);
    const activationKey = await screen.findByRole('option', {
      name: 'name0',
    });
    await user.click(activationKey);
    screen.getByDisplayValue('name0');

    await act(async () => {
      await clickNext();
    });

    // fsc
    (await screen.findByTestId('file-system-config-radio-manual')).click();
    const ap = await screen.findByTestId('file-system-add-partition');
    ap.click();
    ap.click();
    const tbody = screen.getByTestId('file-system-configuration-tbody');
    const rows = within(tbody).getAllByRole('row');
    expect(rows).toHaveLength(3);
    await act(async () => {
      await clickNext();
    });
    // set mountpoint of final row to /var/tmp
    within(rows[2]).getAllByRole('button', { name: 'Options menu' })[0].click();
    within(rows[2]).getByRole('option', { name: '/var' }).click();
    await waitForElementToBeRemoved(() =>
      screen.queryAllByRole('heading', {
        name: 'Danger alert: Duplicate mount point.',
      })
    );
    await user.type(
      within(rows[2]).getByRole('textbox', {
        name: 'Mount point suffix text input',
      }),
      '/tmp'
    );

    // set size of the final row to 100 MiB
    await user.type(
      within(rows[2]).getByRole('textbox', { name: 'Size text input' }),
      '{backspace}100'
    );
    within(rows[2]).getAllByRole('button', { name: 'Options menu' })[1].click();
    within(rows[2]).getByRole('option', { name: 'MiB' }).click();
    await act(async () => {
      await clickNext();
    });

    screen.getByText(
      /Images built with Image Builder include all required packages/i
    );

    const searchbox = screen.getAllByRole('textbox')[0]; // searching by id doesn't update the input ref

    await waitFor(() => expect(searchbox).toBeEnabled());

    await searchForAvailablePackages(searchbox, 'test');
    const bot = screen.getByRole('option', {
      name: /test summary for test package/,
    });
    await act(async () => {
      bot.click();
    });
    const bas = screen.getByRole('button', { name: /Add selected/ });
    await act(async () => {
      bas.click();
    });
    await act(async () => {
      await clickNext();
    });

    // Custom repositories
    await user.click(
      await screen.findByRole('checkbox', { name: /select row 0/i })
    );
    await user.click(
      await screen.findByRole('checkbox', { name: /select row 1/i })
    );

    await act(async () => {
      await clickNext();
      // Custom packages
      await clickNext();
    });

    // Enter image name
    const nameInput = screen.getByRole('textbox', {
      name: 'Image Name',
    });

    await act(async () => {
      await user.type(nameInput, 'my-image-name');
    });

    // Enter description for image
    const descriptionInput = screen.getByRole('textbox', {
      name: /Description/,
    });
    await act(async () => {
      await user.type(
        descriptionInput,
        'this is a perfect description for image'
      );
      await clickNext();
    });

    // review
    const targetEnvironmentsExpandable = await screen.findByTestId(
      'target-environments-expandable'
    );
    targetEnvironmentsExpandable.click();
    await screen.findAllByText('AWS');
    await screen.findAllByText('GCP');
    await screen.findByText('VMWare vSphere (.ova)');
    await screen.findByText('Virtualization - Guest image (.qcow2)');
    await screen.findByText('Bare metal - Installer (.iso)');

    const registrationExpandable = await screen.findByTestId(
      'registration-expandable'
    );
    await act(async () => {
      registrationExpandable.click();
    });
    const review = screen.getByTestId('review-registration');
    expect(review).toHaveTextContent(
      'Use remote host configuration (RHC) utility'
    );

    const imageDetailsExpandable = await screen.findByTestId(
      'image-details-expandable'
    );
    await act(async () => {
      imageDetailsExpandable.click();
    });
    await screen.findByText('my-image-name');
    await screen.findByText('this is a perfect description for image');

    await screen.findByText('name0');
    await screen.findByText('Self-Support');
    await screen.findByText('Production');

    const brp = screen.getByTestId('repositories-popover-button');
    await act(async () => {
      brp.click();
    });
    const repotbody = await screen.findByTestId(
      'additional-repositories-table'
    );
    expect(within(repotbody).getAllByRole('row')).toHaveLength(3);

    const fsc = screen.getByTestId('file-system-configuration-popover');
    await act(async () => {
      fsc.click();
    });
    const revtbody = await screen.findByTestId(
      'file-system-configuration-tbody-review'
    );
    expect(within(revtbody).getAllByRole('row')).toHaveLength(3);

    // mock the backend API
    const composeImage = jest
      .spyOn(api, 'composeImage')
      .mockImplementation((body) => {
        let id;
        if (body.image_requests[0].upload_request.type === 'aws') {
          expect(body).toEqual({
            distribution: RHEL_8,
            image_name: 'my-image-name',
            image_description: 'this is a perfect description for image',
            image_requests: [
              {
                architecture: 'x86_64',
                image_type: 'aws',
                upload_request: {
                  type: 'aws',
                  options: {
                    share_with_accounts: ['012345678901'],
                  },
                },
              },
            ],
            customizations: customizations,
          });
          id = 'edbae1c2-62bc-42c1-ae0c-3110ab718f56';
        } else if (body.image_requests[0].upload_request.type === 'gcp') {
          expect(body).toEqual({
            distribution: RHEL_8,
            image_name: 'my-image-name',
            image_description: 'this is a perfect description for image',
            image_requests: [
              {
                architecture: 'x86_64',
                image_type: 'gcp',
                upload_request: {
                  type: 'gcp',
                  options: {
                    share_with_accounts: ['user:test@test.com'],
                  },
                },
              },
            ],
            customizations: customizations,
          });
          id = 'edbae1c2-62bc-42c1-ae0c-3110ab718f57';
        } else if (body.image_requests[0].upload_request.type === 'azure') {
          expect(body).toEqual({
            distribution: RHEL_8,
            image_name: 'my-image-name',
            image_description: 'this is a perfect description for image',
            image_requests: [
              {
                architecture: 'x86_64',
                image_type: 'azure',
                upload_request: {
                  type: 'azure',
                  options: {
                    tenant_id: 'b8f86d22-4371-46ce-95e7-65c415f3b1e2',
                    subscription_id: '60631143-a7dc-4d15-988b-ba83f3c99711',
                    resource_group: 'testResourceGroup',
                  },
                },
              },
            ],
            customizations: customizations,
          });
          id = 'edbae1c2-62bc-42c1-ae0c-3110ab718f58';
        } else if (body.image_requests[0].image_type === 'vsphere-ova') {
          expect(body).toEqual({
            distribution: RHEL_8,
            image_name: 'my-image-name',
            image_description: 'this is a perfect description for image',
            image_requests: [
              {
                architecture: 'x86_64',
                image_type: 'vsphere-ova',
                upload_request: {
                  type: 'aws.s3',
                  options: {},
                },
              },
            ],
            customizations: customizations,
          });
          id = 'edbae1c2-62bc-42c1-ae0c-3110ab718f59';
        } else if (body.image_requests[0].image_type === 'guest-image') {
          expect(body).toEqual({
            distribution: RHEL_8,
            image_name: 'my-image-name',
            image_description: 'this is a perfect description for image',
            image_requests: [
              {
                architecture: 'x86_64',
                image_type: 'guest-image',
                upload_request: {
                  type: 'aws.s3',
                  options: {},
                },
              },
            ],
            customizations: customizations,
          });
          id = 'edbae1c2-62bc-42c1-ae0c-3110ab718f5a';
        } else if (body.image_requests[0].image_type === 'image-installer') {
          expect(body).toEqual({
            distribution: RHEL_8,
            image_name: 'my-image-name',
            image_description: 'this is a perfect description for image',
            image_requests: [
              {
                architecture: 'x86_64',
                image_type: 'image-installer',
                upload_request: {
                  type: 'aws.s3',
                  options: {},
                },
              },
            ],
            customizations: customizations,
          });
          id = 'edbae1c2-62bc-42c1-ae0c-3110ab718f5b';
        }

        ids.unshift(id);
        return Promise.resolve({ id });
      });

    const create = screen.getByRole('button', { name: /Create/ });
    await act(async () => {
      await user.click(create);
    });

    // API request sent to backend
    expect(composeImage).toHaveBeenCalledTimes(6);

    // returns back to the landing page
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/insights/image-builder')
    );
    expect(store.getState().composes.allIds).toEqual(ids);
    // set test timeout of 20 seconds
  }, 20000);
});
