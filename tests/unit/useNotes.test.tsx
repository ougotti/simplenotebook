/**
 * @jest-environment jsdom
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import { useNotes } from '../../hooks/useNotes';
import { apiClient } from '../../lib/api';

// Mock the API client
jest.mock('../../lib/api', () => ({
  apiClient: {
    listNotes: jest.fn(),
    createNote: jest.fn(),
    updateNote: jest.fn(),
    deleteNote: jest.fn(),
    getNote: jest.fn(),
  },
}));

const mockApiClient = apiClient as jest.Mocked<typeof apiClient>;

describe('useNotes hook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should initialize with empty state', () => {
    const { result } = renderHook(() => useNotes());

    expect(result.current.notes).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should fetch notes successfully', async () => {
    const mockNotes = [
      { id: '1', title: 'Test Note 1', createdAt: '2023-01-01', updatedAt: '2023-01-01' },
      { id: '2', title: 'Test Note 2', createdAt: '2023-01-02', updatedAt: '2023-01-02' },
    ];

    mockApiClient.listNotes.mockResolvedValue({ notes: mockNotes });

    const { result } = renderHook(() => useNotes());

    await act(async () => {
      await result.current.fetchNotes();
    });

    expect(result.current.notes).toEqual(mockNotes);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockApiClient.listNotes).toHaveBeenCalledTimes(1);
  });

  it('should handle fetch notes error', async () => {
    const errorMessage = 'Failed to fetch notes';
    mockApiClient.listNotes.mockRejectedValue(new Error(errorMessage));

    const { result } = renderHook(() => useNotes());

    await act(async () => {
      await result.current.fetchNotes();
    });

    expect(result.current.notes).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe(errorMessage);
  });

  it('should create a note successfully', async () => {
    const newNoteData = { title: 'New Note', content: 'New content' };
    const createdNote = {
      id: 'new-id',
      title: 'New Note',
      content: 'New content',
      createdAt: '2023-01-03',
      updatedAt: '2023-01-03',
    };

    mockApiClient.createNote.mockResolvedValue({ note: createdNote });

    const { result } = renderHook(() => useNotes());

    let returnedNote;
    await act(async () => {
      returnedNote = await result.current.createNote(newNoteData);
    });

    expect(returnedNote).toEqual(createdNote);
    expect(result.current.notes).toEqual([{
      id: 'new-id',
      title: 'New Note',
      createdAt: '2023-01-03',
      updatedAt: '2023-01-03',
    }]);
    expect(result.current.error).toBeNull();
    expect(mockApiClient.createNote).toHaveBeenCalledWith(newNoteData);
  });

  it('should handle create note error', async () => {
    const newNoteData = { title: 'New Note', content: 'New content' };
    const errorMessage = 'Failed to create note';
    mockApiClient.createNote.mockRejectedValue(new Error(errorMessage));

    const { result } = renderHook(() => useNotes());

    await act(async () => {
      try {
        await result.current.createNote(newNoteData);
      } catch (error) {
        // Expected to throw
      }
    });

    expect(result.current.notes).toEqual([]);
    expect(result.current.error).toBe(errorMessage);
  });

  it('should update a note successfully', async () => {
    // Set up initial notes
    const initialNotes = [
      { id: '1', title: 'Original Note', createdAt: '2023-01-01', updatedAt: '2023-01-01' },
    ];

    const { result } = renderHook(() => useNotes());

    // Simulate having notes already
    mockApiClient.listNotes.mockResolvedValue({ notes: initialNotes });
    await act(async () => {
      await result.current.fetchNotes();
    });

    // Now test update
    const updatedNote = {
      id: '1',
      title: 'Updated Note',
      content: 'Updated content',
      createdAt: '2023-01-01',
      updatedAt: '2023-01-02',
    };

    mockApiClient.updateNote.mockResolvedValue({ note: updatedNote });

    await act(async () => {
      await result.current.updateNote('1', { title: 'Updated Note', content: 'Updated content' });
    });

    expect(result.current.notes).toEqual([{
      id: '1',
      title: 'Updated Note',
      createdAt: '2023-01-01',
      updatedAt: '2023-01-02',
    }]);
    expect(result.current.error).toBeNull();
  });

  it('should delete a note successfully', async () => {
    // Set up initial notes
    const initialNotes = [
      { id: '1', title: 'Note 1', createdAt: '2023-01-01', updatedAt: '2023-01-01' },
      { id: '2', title: 'Note 2', createdAt: '2023-01-02', updatedAt: '2023-01-02' },
    ];

    const { result } = renderHook(() => useNotes());

    // Simulate having notes already
    mockApiClient.listNotes.mockResolvedValue({ notes: initialNotes });
    await act(async () => {
      await result.current.fetchNotes();
    });

    // Mock successful delete
    mockApiClient.deleteNote.mockResolvedValue();

    await act(async () => {
      await result.current.deleteNote('1');
    });

    expect(result.current.notes).toEqual([
      { id: '2', title: 'Note 2', createdAt: '2023-01-02', updatedAt: '2023-01-02' },
    ]);
    expect(result.current.error).toBeNull();
    expect(mockApiClient.deleteNote).toHaveBeenCalledWith('1');
  });

  it('should get a single note successfully', async () => {
    const note = {
      id: '1',
      title: 'Test Note',
      content: 'Test content',
      createdAt: '2023-01-01',
      updatedAt: '2023-01-01',
    };

    mockApiClient.getNote.mockResolvedValue({ note });

    const { result } = renderHook(() => useNotes());

    let returnedNote;
    await act(async () => {
      returnedNote = await result.current.getNote('1');
    });

    expect(returnedNote).toEqual(note);
    expect(result.current.error).toBeNull();
    expect(mockApiClient.getNote).toHaveBeenCalledWith('1');
  });

  it('should handle get note error', async () => {
    const errorMessage = 'Failed to get note';
    mockApiClient.getNote.mockRejectedValue(new Error(errorMessage));

    const { result } = renderHook(() => useNotes());

    let returnedNote;
    await act(async () => {
      returnedNote = await result.current.getNote('1');
    });

    expect(returnedNote).toBeNull();
    expect(result.current.error).toBe(errorMessage);
  });

  it('should set loading state during fetch', async () => {
    // Create a promise that we can control
    let resolvePromise: (value: any) => void;
    const promise = new Promise((resolve) => {
      resolvePromise = resolve;
    });

    mockApiClient.listNotes.mockReturnValue(promise);

    const { result } = renderHook(() => useNotes());

    // Start the fetch
    act(() => {
      result.current.fetchNotes();
    });

    // Should be loading
    expect(result.current.loading).toBe(true);

    // Resolve the promise
    await act(async () => {
      resolvePromise!({ notes: [] });
      await promise;
    });

    // Should no longer be loading
    expect(result.current.loading).toBe(false);
  });
});